import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  actorKind,
  followEntity,
  mentionSource,
  mentionTarget,
  notificationChannel,
  notificationFrequency,
  scanStatus,
  updateTarget,
} from './_enums.js';
import { appendOnlyColumns, deletedAt, tenantFk, tenantTable } from './_helpers.js';
import { users } from './identity.js';
import { boards, items } from './structure.js';

/** Atualização (post do feed do item). Corpo em JSON do editor (Tiptap) + texto plano para busca. */
export const updates = tenantTable(
  'updates',
  {
    boardId: uuid('board_id').notNull(),
    itemId: uuid('item_id').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    bodyText: text('body_text').notNull(),
    isPinned: boolean('is_pinned').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('updates', t.tenantId, t.boardId, boards),
    tenantFk('updates', t.tenantId, t.itemId, items),
    index('updates_item_created_idx')
      .on(t.itemId, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
    index('updates_board_created_idx').on(t.boardId, t.createdAt),
  ],
);

/** Resposta a uma atualização. */
export const replies = tenantTable(
  'replies',
  {
    updateId: uuid('update_id').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: jsonb('body').$type<Record<string, unknown>>().notNull(),
    bodyText: text('body_text').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('replies', t.tenantId, t.updateId, updates),
    index('replies_update_created_idx')
      .on(t.updateId, t.createdAt)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Reação (emoji) a uma atualização ou resposta. */
export const reactions = tenantTable(
  'reactions',
  {
    targetType: updateTarget('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
  },
  (t) => [
    uniqueIndex('reactions_target_user_emoji_key').on(t.targetType, t.targetId, t.userId, t.emoji),
    check('reactions_emoji_len', sql`char_length(${t.emoji}) between 1 and 32`),
  ],
);

/** @menção a usuário, time ou "todos" do board, a partir de atualização, resposta ou descrição. */
export const mentions = tenantTable(
  'mentions',
  {
    sourceType: mentionSource('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    itemId: uuid('item_id').notNull(),
    targetType: mentionTarget('target_type').notNull(),
    targetId: uuid('target_id'),
  },
  (t) => [
    tenantFk('mentions', t.tenantId, t.itemId, items),
    index('mentions_target_idx').on(t.tenantId, t.targetType, t.targetId, t.createdAt),
    index('mentions_source_idx').on(t.sourceType, t.sourceId),
    check(
      'mentions_target_required',
      sql`${t.targetType} = 'everyone' or ${t.targetId} is not null`,
    ),
  ],
);

/** Anexo lógico (arquivo) de item/atualização/resposta; o conteúdo vive em `attachment_versions`. */
export const attachments = tenantTable(
  'attachments',
  {
    boardId: uuid('board_id'),
    itemId: uuid('item_id'),
    updateId: uuid('update_id'),
    replyId: uuid('reply_id'),
    fileName: text('file_name').notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('attachments', t.tenantId, t.boardId, boards),
    tenantFk('attachments', t.tenantId, t.itemId, items),
    tenantFk('attachments', t.tenantId, t.updateId, updates),
    tenantFk('attachments', t.tenantId, t.replyId, replies),
    index('attachments_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    index('attachments_board_idx')
      .on(t.boardId)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Versão imutável de um anexo no object storage (chave `tenants/{tenantId}/...`). */
export const attachmentVersions = tenantTable(
  'attachment_versions',
  {
    attachmentId: uuid('attachment_id').notNull(),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: text('checksum_sha256').notNull(),
    scanStatus: scanStatus('scan_status').notNull().default('pending'),
  },
  (t) => [
    tenantFk('attachment_versions', t.tenantId, t.attachmentId, attachments),
    uniqueIndex('attachment_versions_attachment_version_key').on(t.attachmentId, t.version),
    uniqueIndex('attachment_versions_storage_key_key').on(t.storageKey),
    check('attachment_versions_size', sql`${t.sizeBytes} >= 0`),
  ],
);

/**
 * Log de atividade (visível ao usuário no painel do item/board). Append-only, distinto da
 * auditoria de compliance (ADR 0015).
 */
export const activityLogs = tenantTable(
  'activity_logs',
  {
    boardId: uuid('board_id'),
    itemId: uuid('item_id'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorKind: actorKind('actor_kind').notNull().default('user'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    columnKey: text('column_key'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    tenantFk('activity_logs', t.tenantId, t.boardId, boards),
    tenantFk('activity_logs', t.tenantId, t.itemId, items),
    index('activity_logs_item_created_idx').on(t.itemId, t.createdAt),
    index('activity_logs_board_created_idx').on(t.boardId, t.createdAt),
  ],
  appendOnlyColumns(),
);

/** Notificação in-app de um usuário. */
export const notifications = tenantTable(
  'notifications',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    boardId: uuid('board_id'),
    itemId: uuid('item_id'),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    tenantFk('notifications', t.tenantId, t.boardId, boards),
    tenantFk('notifications', t.tenantId, t.itemId, items),
    index('notifications_user_unread_idx')
      .on(t.tenantId, t.userId, t.createdAt)
      .where(sql`${t.readAt} is null and ${t.archivedAt} is null`),
    index('notifications_user_created_idx').on(t.tenantId, t.userId, t.createdAt),
  ],
);

/** Preferência de notificação por canal e tipo de evento (`*` = padrão). */
export const notificationPreferences = tenantTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull(),
    eventType: text('event_type').notNull().default('*'),
    enabled: boolean('enabled').notNull().default(true),
    frequency: notificationFrequency('frequency').notNull().default('instant'),
  },
  (t) => [
    uniqueIndex('notification_preferences_key').on(t.tenantId, t.userId, t.channel, t.eventType),
  ],
);

/** Seguir (inscrever-se em) board, item ou dashboard para receber notificações. */
export const follows = tenantTable(
  'follows',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: followEntity('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
  },
  (t) => [
    uniqueIndex('follows_user_entity_key').on(t.tenantId, t.userId, t.entityType, t.entityId),
    index('follows_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  ],
);
