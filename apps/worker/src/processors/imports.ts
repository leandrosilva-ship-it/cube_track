import {
  loadBoardDefinition,
  schema,
  type DatabaseHandle,
  type StoredColumn,
  type Transaction,
} from '@cube-track/db';
import {
  ImportJobPayloadSchema,
  newId,
  normalizeForMatch,
  parseCellText,
  positionBetween,
  type CellTextDirectory,
} from '@cube-track/shared';
import type { Job } from 'bullmq';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Logger } from '../logger.js';
import { runAsSystem } from '../system-tx.js';

const { importJobs, groups, items, memberships, users, teams, statusLabels, dropdownOptions } = schema;

const MAX_REPORTED_ERRORS = 200;

interface StagedImport {
  headers: string[];
  rows: string[][];
}

interface ImportRowError {
  row: number;
  message: string;
}

/** Mesmo prefixo de chave usado por `ImportsService.preview` (API) — `bgimport:` em vez de `import:`
 * (prefixo já usado pelo importador síncrono do Prompt 5) para nunca haver ambiguidade entre os dois
 * pipelines, mesmo que, por coincidência, compartilhem `tenantId`+`importId`. */
function stageKey(tenantId: string, importJobId: string): string {
  return `bgimport:${tenantId}:${importJobId}`;
}

/**
 * Processador do job de importação em background (ADR 0056: Monday/Trello/Jira/Pipefy/CSV) — a
 * mesma lógica de commit do importador síncrono (`ImportExportService.commit`), linha a linha, mas
 * dentro de um job do worker em vez da requisição HTTP do upload. Sempre cria grupos/rótulos/opções
 * citados na planilha que ainda não existem (não há alternância "createMissing" nesta API — ao
 * importar um board inteiro de outra ferramenta, é isso que se espera). `status: 'failed'` só quando
 * o job inteiro não consegue nem começar (dados expirados no Redis, board ausente, mapeamento sem
 * coluna de nome); linhas ruins individualmente viram `skipped` + entrada em `errorReport`, e o job
 * ainda termina `completed`.
 */
export function importsProcessor(deps: { database: DatabaseHandle; redis: Redis; logger: Logger }) {
  return async function processImportJob(job: Job): Promise<{ status: 'completed' | 'failed' }> {
    const payload = ImportJobPayloadSchema.parse(job.data);
    const stagedRaw = await deps.redis.get(stageKey(payload.tenantId, payload.importJobId));

    return runAsSystem(
      deps.database,
      deps.redis,
      payload.tenantId,
      { kind: 'import', causationId: null, depth: 0, correlationId: payload.importJobId },
      async (unit) => {
        const tx = unit.tx;
        const [row] = await tx
          .select()
          .from(importJobs)
          .where(and(eq(importJobs.id, payload.importJobId), eq(importJobs.tenantId, payload.tenantId)))
          .for('update');
        if (row === undefined) {
          deps.logger.error({ importJobId: payload.importJobId }, 'Job de importação não encontrado');
          return { status: 'failed' as const };
        }
        const fail = async (message: string) => {
          await tx
            .update(importJobs)
            .set({ status: 'failed', errorReport: [{ row: 0, message }], finishedAt: new Date() })
            .where(eq(importJobs.id, row.id));
          await unit.audit({
            action: 'import_job.failed',
            entityType: 'import_job',
            entityId: row.id,
            metadata: { message },
          });
          await unit.emit({
            type: 'import_job.changed',
            aggregateType: 'import_job',
            aggregateId: row.id,
            boardId: row.boardId,
            payload: { jobId: row.id, boardId: row.boardId, status: 'failed' },
          });
          return { status: 'failed' as const };
        };

        if (stagedRaw === null) return fail('Dados da importação expiraram. Refaça o upload.');
        let staged: StagedImport;
        try {
          staged = JSON.parse(stagedRaw) as StagedImport;
        } catch {
          return fail('Dados da importação corrompidos.');
        }
        const definition = await loadBoardDefinition(tx, row.boardId);
        if (definition === null) return fail('Board não encontrado.');

        const mapping = row.mapping;
        const entries = Object.entries(mapping);
        const nameIndex = entries.find(([, target]) => target.type === 'name')?.[0];
        if (nameIndex === undefined) return fail('Mapeamento sem coluna de nome do item.');
        const groupIndex = entries.find(([, target]) => target.type === 'group')?.[0];
        const columnTargets = entries.flatMap(([index, target]) => {
          if (target.type !== 'column') return [];
          const column = definition.columns.find((entry) => entry.key === target.key);
          return column === undefined ? [] : [{ index: Number(index), column }];
        });

        await tx.update(importJobs).set({ status: 'processing', startedAt: new Date() }).where(eq(importJobs.id, row.id));

        const directory = await loadDirectory(tx);
        const groupsByName = new Map<string, string>(
          (
            await tx
              .select({ id: groups.id, name: groups.name })
              .from(groups)
              .where(and(eq(groups.boardId, row.boardId), isNull(groups.deletedAt)))
          ).map((entry) => [normalizeForMatch(entry.name), entry.id]),
        );
        // Grupo padrão das linhas sem grupo mapeado/reconhecido: o primeiro grupo existente do board;
        // "Importados" só é criado de fato (lazy) se alguma linha realmente precisar dele.
        let defaultGroupId: string | undefined = groupsByName.values().next().value;
        const resolveDefaultGroup = async (): Promise<string> => {
          defaultGroupId ??= await createGroup(tx, payload.tenantId, row.boardId, 'Importados', groupsByName);
          return defaultGroupId;
        };
        const lastPositions = new Map<string, string | null>();
        let created = 0;
        let skipped = 0;
        const errors: ImportRowError[] = [];
        const report = (rowNumber: number, message: string) => {
          if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row: rowNumber, message });
        };

        for (const [rowIndex, cells] of staged.rows.entries()) {
          const rowNumber = rowIndex + 2;
          const name = (cells[Number(nameIndex)] ?? '').trim();
          if (name === '') {
            skipped += 1;
            report(rowNumber, 'Linha sem nome.');
            continue;
          }
          const groupName = groupIndex === undefined ? '' : (cells[Number(groupIndex)] ?? '').trim();
          const groupId =
            groupName === ''
              ? await resolveDefaultGroup()
              : (groupsByName.get(normalizeForMatch(groupName)) ??
                (await createGroup(tx, payload.tenantId, row.boardId, groupName, groupsByName)));

          const values: Record<string, Record<string, unknown>> = {};
          let failedRow = false;
          for (const { index, column } of columnTargets) {
            const text = cells[index] ?? '';
            let parsed = parseCellText(column, text, directory, 'pt-BR');
            if (!parsed.ok && (parsed.reason === 'unknown_label' || parsed.reason === 'unknown_option')) {
              await createChoices(tx, payload.tenantId, column, parsed.unknown ?? []);
              parsed = parseCellText(column, text, directory, 'pt-BR');
            }
            if (!parsed.ok) {
              failedRow = true;
              report(rowNumber, `Coluna "${column.title}": valor inválido.`);
              continue;
            }
            if (parsed.value !== null) values[column.key] = parsed.value;
          }
          if (failedRow) {
            skipped += 1;
            continue;
          }
          if (!lastPositions.has(groupId)) {
            const [last] = await tx
              .select({ position: items.position })
              .from(items)
              .where(and(eq(items.groupId, groupId), isNull(items.deletedAt)))
              .orderBy(desc(items.position))
              .limit(1);
            lastPositions.set(groupId, last?.position ?? null);
          }
          const position = positionBetween(lastPositions.get(groupId) ?? null, null);
          try {
            const [inserted] = await tx
              .insert(items)
              .values({ tenantId: payload.tenantId, boardId: row.boardId, groupId, name, values, position })
              .returning({ id: items.id });
            if (inserted === undefined) throw new Error('Falha ao inserir item');
            lastPositions.set(groupId, position);
            created += 1;
            // Sem evento `item.created` por linha aqui de propósito: um export inteiro pode ter
            // milhares de linhas — a tela de importação acompanha o progresso pelo `import_job.changed`
            // (abaixo) e recarrega o board quando o job termina, em vez de milhares de eventos
            // realtime individuais.
          } catch (error) {
            skipped += 1;
            report(rowNumber, error instanceof Error ? error.message : 'Falha ao criar o item.');
          }
        }

        await tx
          .update(importJobs)
          .set({
            status: 'completed',
            createdCount: created,
            skippedCount: skipped,
            errorReport: errors,
            finishedAt: new Date(),
          })
          .where(eq(importJobs.id, row.id));
        await unit.audit({
          action: 'import_job.completed',
          entityType: 'import_job',
          entityId: row.id,
          after: { created, skipped, errors: errors.length },
        });
        await unit.emit({
          type: 'import_job.changed',
          aggregateType: 'import_job',
          aggregateId: row.id,
          boardId: row.boardId,
          payload: { jobId: row.id, boardId: row.boardId, status: 'completed' },
        });
        await deps.redis.del(stageKey(payload.tenantId, payload.importJobId));
        return { status: 'completed' as const };
      },
    );
  };
}

async function loadDirectory(tx: Transaction): Promise<CellTextDirectory> {
  const people = await tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(isNull(memberships.deletedAt));
  const teamRows = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.deletedAt));
  return { people, teams: teamRows };
}

async function createGroup(
  tx: Transaction,
  tenantId: string,
  boardId: string,
  name: string,
  groupsByName: Map<string, string>,
): Promise<string> {
  const id = newId();
  await tx.insert(groups).values({ id, tenantId, boardId, name, position: positionBetween(null, null) });
  groupsByName.set(normalizeForMatch(name), id);
  return id;
}

async function createChoices(
  tx: Transaction,
  tenantId: string,
  column: StoredColumn,
  labels: string[],
): Promise<void> {
  const unique = [...new Set(labels.map((entry) => entry.trim()))].filter((entry) => entry !== '');
  for (const label of unique) {
    const id = newId();
    if (column.type === 'status') {
      const position = positionBetween(column.labels.at(-1)?.position ?? null, null);
      await tx.insert(statusLabels).values({ id, tenantId, columnId: column.id, label, color: '#579bfc', category: 'in_progress', position });
      column.labels.push({ id, label, color: '#579bfc', category: 'in_progress', position });
    } else {
      const position = positionBetween(column.options.at(-1)?.position ?? null, null);
      await tx.insert(dropdownOptions).values({ id, tenantId, columnId: column.id, label, position });
      column.options.push({ id, label, color: null, position });
    }
  }
}
