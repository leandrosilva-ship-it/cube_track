import type { ImportJobResult, ImportMapping } from '@cube-track/shared';
import { integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { importJobStatus, importSource } from './_enums.js';
import { tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards } from './structure.js';

/**
 * Job de importação (Monday/Trello/Jira/Pipefy/CSV, Prompt 15, ADR 0056): o commit (criar grupos e
 * itens linha a linha) roda em background no worker, nunca dentro da requisição HTTP do upload — as
 * linhas brutas ficam no Redis (`import:{tenantId}:{jobId}`, TTL curto, mesmo padrão do import
 * síncrono do Prompt 5); esta tabela só guarda o estado/resultado/relatório de erro, que sobrevive
 * mesmo depois do Redis expirar.
 */
export const importJobs = tenantTable(
  'import_jobs',
  {
    boardId: uuid('board_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: importSource('source').notNull(),
    status: importJobStatus('status').notNull().default('uploaded'),
    fileName: text('file_name').notNull(),
    mapping: jsonb('mapping').$type<ImportMapping>().notNull(),
    totalRows: integer('total_rows').notNull(),
    createdCount: integer('created_count'),
    skippedCount: integer('skipped_count'),
    errorReport: jsonb('error_report').$type<ImportJobResult['errors']>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [tenantFk('import_jobs', t.tenantId, t.boardId, boards)],
);
