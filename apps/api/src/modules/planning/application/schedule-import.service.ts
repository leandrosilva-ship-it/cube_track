import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, positionBetween } from '@cube-track/shared';
import { XMLParser } from 'fast-xml-parser';
import type { Redis } from 'ioredis';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { REDIS } from '../../../core/redis/redis.module.js';
import { AccessService } from '../../access/application/access.service.js';
import { IMPORT_MAX_BYTES } from '../../work/application/import-export.service.js';
import { ItemWriter } from '../../work/application/item-writer.js';
import { ItemsRepository } from '../../work/infrastructure/items.repository.js';

const { dependencies } = schema;

const IMPORT_TTL_SECONDS = 1_800;
const IMPORT_MAX_TASKS = 2_000;
/** Projetos MSPDI têm uma "tarefa 0" implícita (o projeto inteiro) — nunca é uma tarefa real. */
const PROJECT_SUMMARY_UID = '0';
/** Tipo de vínculo MSPDI (padrão da indústria): 0=FF, 1=FS, 2=SF, 3=SS. */
const LINK_TYPES = ['FF', 'FS', 'SF', 'SS'] as const;
/** `LinkLag` vem em décimos de minuto; aproxima para dias úteis assumindo jornada de 8h. */
const LAG_UNITS_PER_DAY = 8 * 60 * 10;

export interface MspTaskLink {
  predecessorUid: string;
  type: (typeof LINK_TYPES)[number];
  lagDays: number;
}

export interface MspTask {
  uid: string;
  name: string;
  start: string | null;
  finish: string | null;
  milestone: boolean;
  predecessors: MspTaskLink[];
}

/** Lê `<Task>` do XML MSPDI (Microsoft Project), já normalizado (listas sempre array). */
export function parseMspXml(xml: string): MspTask[] {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });
  const doc: unknown = parser.parse(xml);
  const project = record(doc)?.Project;
  const tasksNode = record(project)?.Tasks;
  const rawTasks = asArray(record(tasksNode)?.Task);
  const tasks: MspTask[] = [];
  for (const raw of rawTasks) {
    const task = record(raw);
    if (task === null) continue;
    const uid = str(task.UID).trim();
    if (uid === '' || uid === PROJECT_SUMMARY_UID) continue;
    const links = asArray(task.PredecessorLink).flatMap((rawLink) => {
      const link = record(rawLink);
      if (link === null) return [];
      const predecessorUid = str(link.PredecessorUID).trim();
      if (predecessorUid === '') return [];
      const typeIndex = Math.trunc(Number(link.Type ?? 1));
      const type = LINK_TYPES[typeIndex] ?? 'FS';
      const lagRaw = Number(link.LinkLag ?? 0);
      const lagDays = Number.isFinite(lagRaw)
        ? Math.max(-3650, Math.min(3650, Math.round(lagRaw / LAG_UNITS_PER_DAY)))
        : 0;
      return [{ predecessorUid, type, lagDays }];
    });
    tasks.push({
      uid,
      name: str(task.Name).trim(),
      start: toDateOnly(task.Start),
      finish: toDateOnly(task.Finish),
      milestone: str(task.Milestone, '0').trim() === '1',
      predecessors: links,
    });
  }
  return tasks;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Converte um valor do XML (texto/número já lidos pelo parser) para string, sem `[object Object]`. */
function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function toDateOnly(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match?.[1] ?? null;
}

export interface SchedulePreview {
  importId: string;
  fileName: string;
  totalTasks: number;
  sample: { name: string; start: string | null; finish: string | null; milestone: boolean }[];
  dependencyCount: number;
  warnings: string[];
}

export interface ScheduleImportResult {
  created: number;
  skipped: number;
  dependenciesCreated: number;
  errors: { task: string; message: string }[];
}

interface StoredSchedule {
  boardId: string;
  userId: string;
  fileName: string;
  tasks: MspTask[];
}

/**
 * Importa um cronograma MS Project (.xml/MSPDI, ADR 0049): tarefas viram itens do grupo escolhido
 * (planejado a partir de Start/Finish, marco quando `Milestone=1`) e os vínculos entre tarefas viram
 * dependências (FS/SS/FF/SF + lag aproximado em dias úteis, jornada de 8h). `.mpp` (binário
 * proprietário) está fora de escopo — o prompt permite explicitamente pular esse formato.
 * A hierarquia de subitens (Outline Level) não é reconstruída nesta versão: todas as tarefas entram
 * como itens de topo no grupo escolhido.
 */
@Injectable()
export class ScheduleImportService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly writer: ItemWriter,
    private readonly repository: ItemsRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async preview(
    user: AuthPrincipal,
    boardId: string,
    input: { fileName: string; contentBase64: string },
  ): Promise<SchedulePreview> {
    await this.access.assert(user, 'schedule.manage', { type: 'board', id: boardId }, 'Board');
    const buffer = Buffer.from(input.contentBase64, 'base64');
    if (buffer.byteLength > IMPORT_MAX_BYTES)
      throw new PayloadTooLargeError('Arquivo acima de 10 MB.');
    if (!input.fileName.toLowerCase().endsWith('.xml')) {
      throw new UnprocessableError(
        'Apenas cronogramas MS Project em .xml são aceitos (.mpp não é suportado).',
        'unsupported_format',
      );
    }
    let tasks: MspTask[];
    try {
      tasks = parseMspXml(buffer.toString('utf8'));
    } catch {
      throw new UnprocessableError('Não foi possível ler o XML do MS Project.', 'invalid_xml');
    }
    if (tasks.length === 0)
      throw new UnprocessableError('O arquivo não tem tarefas.', 'import_empty');
    if (tasks.length > IMPORT_MAX_TASKS)
      throw new UnprocessableError(
        `Máximo de ${String(IMPORT_MAX_TASKS)} tarefas por importação.`,
        'import_too_large',
      );
    const warnings: string[] = [];
    const knownUids = new Set(tasks.map((task) => task.uid));
    const dependencyCount = tasks.reduce((total, task) => total + task.predecessors.length, 0);
    const danglingLinks = tasks.some((task) =>
      task.predecessors.some((link) => !knownUids.has(link.predecessorUid)),
    );
    if (danglingLinks) {
      warnings.push('Alguns vínculos referenciam tarefas fora do arquivo e serão ignorados.');
    }
    if (tasks.some((task) => task.start === null || task.finish === null)) {
      warnings.push('Algumas tarefas não têm datas e entrarão sem planejamento inicial.');
    }
    const importId = newId();
    const stored: StoredSchedule = { boardId, userId: user.userId, fileName: input.fileName, tasks };
    await this.redis.set(
      this.key(user, importId),
      JSON.stringify(stored),
      'EX',
      IMPORT_TTL_SECONDS,
    );
    return {
      importId,
      fileName: input.fileName,
      totalTasks: tasks.length,
      sample: tasks.slice(0, 10).map((task) => ({
        name: task.name,
        start: task.start,
        finish: task.finish,
        milestone: task.milestone,
      })),
      dependencyCount,
      warnings,
    };
  }

  async commit(
    user: AuthPrincipal,
    boardId: string,
    importId: string,
    groupId: string,
  ): Promise<ScheduleImportResult> {
    await this.access.assert(user, 'schedule.manage', { type: 'board', id: boardId }, 'Board');
    const raw = await this.redis.get(this.key(user, importId));
    if (raw === null) throw new NotFoundError('Importação');
    const stored = JSON.parse(raw) as StoredSchedule;
    if (stored.boardId !== boardId || stored.userId !== user.userId)
      throw new NotFoundError('Importação');
    const tx = this.runner.tx;
    const group = await this.repository.findGroup(tx, groupId);
    if (group?.boardId !== boardId)
      throw new ValidationError([{ path: 'body.groupId', message: 'Grupo não pertence ao board.' }]);

    const context = await this.writer.context(user, boardId);
    const result: ScheduleImportResult = {
      created: 0,
      skipped: 0,
      dependenciesCreated: 0,
      errors: [],
    };
    const itemIdByUid = new Map<string, string>();
    let lastPosition = await this.repository.lastPosition(tx, groupId, null);
    for (const task of stored.tasks) {
      if (task.name === '') {
        result.skipped += 1;
        result.errors.push({ task: task.uid, message: 'Tarefa sem nome.' });
        continue;
      }
      const position = positionBetween(lastPosition, null);
      try {
        const item = await this.writer.insert(
          context,
          {
            groupId,
            name: task.name,
            position,
            fields: { plannedStartDate: task.start, plannedEndDate: task.finish },
            isMilestone: task.milestone,
          },
          { checkPermissions: false, enforceRequired: false },
        );
        lastPosition = position;
        await this.writer.emitCreated(context, item, 'imported', false);
        itemIdByUid.set(task.uid, item.id);
        result.created += 1;
      } catch (error) {
        result.skipped += 1;
        result.errors.push({
          task: task.name,
          message: error instanceof Error ? error.message : 'Falha ao criar o item.',
        });
      }
    }

    const seenLinks = new Set<string>();
    const links: (typeof dependencies.$inferInsert)[] = [];
    for (const task of stored.tasks) {
      const successorId = itemIdByUid.get(task.uid);
      if (successorId === undefined) continue;
      for (const link of task.predecessors) {
        const predecessorId = itemIdByUid.get(link.predecessorUid);
        if (predecessorId === undefined || predecessorId === successorId) continue;
        const key = `${predecessorId}:${successorId}`;
        if (seenLinks.has(key)) continue;
        seenLinks.add(key);
        links.push({
          tenantId: user.tenantId,
          boardId,
          predecessorId,
          successorId,
          type: link.type,
          lagDays: link.lagDays,
          createdBy: user.userId,
        });
      }
    }
    if (links.length > 0) {
      await tx.insert(dependencies).values(links).onConflictDoNothing();
      result.dependenciesCreated = links.length;
    }

    this.events.recordChange({
      action: 'board.schedule_imported',
      entityType: 'board',
      entityId: boardId,
      boardId,
      after: {
        fileName: stored.fileName,
        created: result.created,
        skipped: result.skipped,
        dependenciesCreated: result.dependenciesCreated,
      },
    });
    await this.redis.del(this.key(user, importId));
    return result;
  }

  private key(user: AuthPrincipal, importId: string): string {
    return `schedule-import:${user.tenantId}:${user.userId}:${importId}`;
  }
}
