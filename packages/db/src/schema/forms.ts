import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { appendOnlyColumns, deletedAt, position, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards, groups, items } from './structure.js';

/**
 * Formulário que cria itens num board/grupo. Pode ser público (token como hash) ou exigir login.
 * Resolução pública via `app.resolve_public_form` (SECURITY DEFINER).
 */
export const forms = tenantTable(
  'forms',
  {
    boardId: uuid('board_id').notNull(),
    targetGroupId: uuid('target_group_id'),
    name: text('name').notNull(),
    description: text('description'),
    isPublic: boolean('is_public').notNull().default(false),
    publicTokenHash: text('public_token_hash'),
    requiresLogin: boolean('requires_login').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('forms', t.tenantId, t.boardId, boards),
    tenantFk('forms', t.tenantId, t.targetGroupId, groups, 'set null'),
    uniqueIndex('forms_public_token_hash_key')
      .on(t.publicTokenHash)
      .where(sql`${t.publicTokenHash} is not null`),
    check('forms_public_token', sql`not ${t.isPublic} or ${t.publicTokenHash} is not null`),
  ],
);

/** Campo do formulário, normalmente mapeado para uma coluna do board. */
export const formFields = tenantTable(
  'form_fields',
  {
    formId: uuid('form_id').notNull(),
    columnKey: text('column_key'),
    label: text('label').notNull(),
    helpText: text('help_text'),
    fieldType: text('field_type').notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    showWhen: jsonb('show_when').$type<Record<string, unknown>>(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    position: position('position').notNull(),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('form_fields', t.tenantId, t.formId, forms),
    index('form_fields_form_position_idx')
      .on(t.formId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Envio de formulário (append-only) e o item resultante. */
export const formSubmissions = tenantTable(
  'form_submissions',
  {
    formId: uuid('form_id').notNull(),
    itemId: uuid('item_id'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    submitterEmail: text('submitter_email'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    tenantFk('form_submissions', t.tenantId, t.formId, forms),
    tenantFk('form_submissions', t.tenantId, t.itemId, items, 'set null'),
    index('form_submissions_form_created_idx').on(t.formId, t.createdAt),
  ],
  appendOnlyColumns(),
);
