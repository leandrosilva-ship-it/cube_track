import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  isImportSource,
  newId,
  parseCsv,
  QUEUES,
  suggestImportMapping,
  trelloExportToTable,
  type ImportJobResult,
  type ImportMapping,
  type ImportSource,
} from '@cube-track/shared';
import { and, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../../../core/queues/queues.module.js';
import { REDIS } from '../../../core/redis/redis.module.js';
import { AccessService } from '../../access/application/access.service.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';

const { importJobs } = schema;

type ImportJobRow = typeof importJobs.$inferSelect;

/** Limite de tamanho do arquivo (10 MB, mesmo teto do importador síncrono — ADR 0042). */
export const BACKGROUND_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
/** Teto de linhas por importação em background — maior que o síncrono (5 mil) porque este pipeline
 * roda fora da requisição HTTP e existe justamente para exports grandes de outra ferramenta. */
export const BACKGROUND_IMPORT_MAX_ROWS = 50_000;
const STAGE_TTL_SECONDS = 3_600;

export interface ImportJobDto {
  id: string;
  boardId: string;
  source: ImportSource;
  status: 'uploaded' | 'processing' | 'completed' | 'failed';
  fileName: string;
  mapping: ImportMapping;
  totalRows: number;
  createdCount: number | null;
  skippedCount: number | null;
  errorReport: ImportJobResult['errors'] | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface PreviewInput {
  source: string;
  fileName: string;
  contentBase64: string;
}

export interface PreviewResult {
  importJobId: string;
  headers: string[];
  sample: string[][];
  totalRows: number;
  suggestedMapping: ImportMapping;
}

function toDto(row: ImportJobRow): ImportJobDto {
  return {
    id: row.id,
    boardId: row.boardId,
    source: row.source,
    status: row.status,
    fileName: row.fileName,
    mapping: row.mapping,
    totalRows: row.totalRows,
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    errorReport: row.errorReport,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Chave do Redis onde ficam as linhas brutas em prévia — prefixo PRÓPRIO (`bgimport:`), diferente do
 * `import:` do importador síncrono (`import-export.service.ts`), para nunca colidir mesmo que, por
 * coincidência, dois uploads diferentes caiam no mesmo `tenantId`+id gerado. */
function stageKey(tenantId: string, importJobId: string): string {
  return `bgimport:${tenantId}:${importJobId}`;
}

/**
 * Importação em background de exports do Monday/Trello/Jira/Pipefy (e CSV genérico) — ADR 0056.
 * Diferente do importador síncrono (`work/application/import-export.service.ts`, mantido como está
 * para uploads pequenos feitos à mão): aqui o commit roda inteiramente no worker (fila `imports`),
 * com um registro persistente (`import_jobs`) que sobrevive à expiração do Redis e dá à tela de
 * importação algo para consultar enquanto o job processa.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly definitions: BoardDefinitionRepository,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async preview(user: AuthPrincipal, boardId: string, input: PreviewInput): Promise<PreviewResult> {
    await this.access.assert(user, 'item.create', { type: 'board', id: boardId }, 'Board');
    if (!isImportSource(input.source))
      throw new ValidationError([{ path: 'body.source', message: `Origem desconhecida: ${input.source}.` }]);
    const source = input.source;
    const buffer = Buffer.from(input.contentBase64, 'base64');
    if (buffer.byteLength > BACKGROUND_IMPORT_MAX_BYTES)
      throw new PayloadTooLargeError('Arquivo acima de 10 MB.');

    const table = source === 'trello' ? this.parseTrello(buffer) : this.parseTabular(buffer);
    const { headers: headerRow, rows } = table;
    if (headerRow.length === 0 || rows.length === 0)
      throw new UnprocessableError('O arquivo não tem linhas de dados.', 'import_empty');
    if (rows.length > BACKGROUND_IMPORT_MAX_ROWS)
      throw new UnprocessableError(
        `Máximo de ${String(BACKGROUND_IMPORT_MAX_ROWS)} linhas por importação.`,
        'import_too_large',
      );
    const headers = headerRow.map((header, index) => header.trim() || `#${String(index + 1)}`);
    const width = headers.length;
    const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));

    const definition = await this.definitions.load(this.runner.tx, boardId);
    const boardColumns = definition?.columns.map((column) => ({ key: column.key, title: column.title })) ?? [];
    const mapping = suggestImportMapping(source, headers, boardColumns);

    const importJobId = newId();
    await this.redis.set(
      stageKey(user.tenantId, importJobId),
      JSON.stringify({ headers, rows: normalizedRows }),
      'EX',
      STAGE_TTL_SECONDS,
    );
    const [row] = await this.runner.tx
      .insert(importJobs)
      .values({
        id: importJobId,
        tenantId: user.tenantId,
        boardId,
        userId: user.userId,
        source,
        status: 'uploaded',
        fileName: input.fileName,
        mapping,
        totalRows: normalizedRows.length,
        createdBy: user.userId,
      })
      .returning({ id: importJobs.id });
    if (row === undefined) throw new Error('Falha ao registrar a importação');
    return {
      importJobId,
      headers,
      sample: normalizedRows.slice(0, 10),
      totalRows: normalizedRows.length,
      suggestedMapping: mapping,
    };
  }

  async updateMapping(user: AuthPrincipal, importJobId: string, mapping: ImportMapping): Promise<ImportJobDto> {
    const existing = await this.findAccessible(user, importJobId, 'edit');
    if (existing.status !== 'uploaded')
      throw new ConflictError('Só é possível ajustar o mapeamento antes do commit.', 'import_already_committed');
    const [row] = await this.runner.tx
      .update(importJobs)
      .set({ mapping })
      .where(eq(importJobs.id, importJobId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar o mapeamento');
    return toDto(row);
  }

  async commit(user: AuthPrincipal, importJobId: string): Promise<ImportJobDto> {
    const existing = await this.findAccessible(user, importJobId, 'edit');
    if (existing.status !== 'uploaded')
      throw new ConflictError('Esta importação já foi confirmada.', 'import_already_committed');
    const [row] = await this.runner.tx
      .update(importJobs)
      .set({ status: 'processing', startedAt: new Date() })
      .where(eq(importJobs.id, importJobId))
      .returning();
    if (row === undefined) throw new Error('Falha ao confirmar a importação');
    await this.queues[QUEUES.imports].add(
      'commit',
      { tenantId: user.tenantId, importJobId, userId: user.userId, boardId: existing.boardId },
      { jobId: `import-job.${importJobId}` },
    );
    return toDto(row);
  }

  async get(user: AuthPrincipal, importJobId: string): Promise<ImportJobDto> {
    return toDto(await this.findAccessible(user, importJobId, 'read'));
  }

  // ------------------------------------------------------------------------------ internos ---

  private parseTrello(buffer: Buffer): { headers: string[]; rows: string[][] } {
    let json: unknown;
    try {
      json = JSON.parse(buffer.toString('utf8'));
    } catch {
      throw new UnprocessableError('JSON do export do Trello inválido.', 'import_unreadable');
    }
    try {
      return trelloExportToTable(json);
    } catch (error) {
      throw new UnprocessableError(
        error instanceof Error ? error.message : 'Export do Trello inválido.',
        'import_format',
      );
    }
  }

  private parseTabular(buffer: Buffer): { headers: string[]; rows: string[][] } {
    const [headers, ...rows] = parseCsv(buffer.toString('utf8'));
    return { headers: headers ?? [], rows };
  }

  /** `edit`: só quem iniciou a importação pode ajustar mapeamento/confirmar. `read`: também quem tem
   * `item.create` no board (acompanhar o progresso de uma importação de outra pessoa). */
  private async findAccessible(
    user: AuthPrincipal,
    importJobId: string,
    mode: 'edit' | 'read',
  ): Promise<ImportJobRow> {
    const [row] = await this.runner.tx
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, importJobId), eq(importJobs.tenantId, user.tenantId)));
    if (row === undefined) throw new NotFoundError('Importação');
    if (row.userId === user.userId) return row;
    if (mode === 'edit') throw new NotFoundError('Importação');
    await this.access.assert(user, 'item.create', { type: 'board', id: row.boardId }, 'Importação');
    return row;
  }
}
