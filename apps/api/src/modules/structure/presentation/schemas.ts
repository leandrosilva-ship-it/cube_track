import {
  FilterGroupSchema,
  KanbanConfigSchema,
  TableConfigSchema,
  VIEW_TYPES,
  ViewGroupBySchema,
  ViewSortSchema,
} from '@cube-track/shared';
import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor hexadecimal (#rrggbb).');
const neighbors = {
  /** Elemento que fica imediatamente ANTES da nova posição. */
  afterId: z.uuid().nullable().optional(),
  /** Elemento que fica imediatamente DEPOIS da nova posição. */
  beforeId: z.uuid().nullable().optional(),
};

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });
export const FavoriteParams = z.object({
  entityType: z.enum(['workspace', 'folder', 'board']),
  entityId: z.uuid(),
});

export const CreateWorkspaceBody = z.object({
  name,
  description: z.string().max(2_000).optional(),
  color: color.optional(),
});

export const FolderSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  name: z.string(),
  color: z.string().nullable(),
  position: z.string(),
});
export const TreeBoardSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  folderId: z.uuid().nullable(),
  kind: z.enum(['board', 'project', 'process', 'backlog']),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(['main', 'private', 'shareable']),
  position: z.string(),
});
export const TreeSchema = z.object({
  workspaceId: z.uuid(),
  canManageFolders: z.boolean(),
  canCreateBoards: z.boolean(),
  folders: z.array(FolderSchema),
  boards: z.array(TreeBoardSchema),
});

export const CreateFolderBody = z.object({
  name,
  parentId: z.uuid().nullable().optional(),
  color: color.optional(),
});
export const UpdateFolderBody = z.object({
  name: name.optional(),
  color: color.nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  ...neighbors,
});

const icon = z.string().regex(/^[a-z0-9-]{1,40}$/);
export const CreateBoardBody = z.object({
  name,
  description: z.string().max(2_000).optional(),
  icon: icon.nullable().optional(),
  folderId: z.uuid().nullable().optional(),
  kind: z.enum(['board', 'project', 'process', 'backlog']).optional(),
  visibility: z.enum(['main', 'private', 'shareable']).optional(),
  template: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('builtin'), key: z.string().min(1).max(40) }),
      z.object({
        kind: z.literal('board'),
        boardId: z.uuid(),
        includeItems: z.boolean().optional(),
      }),
    ])
    .optional(),
});
export const UpdateBoardBody = z.object({
  name: name.optional(),
  description: z.string().max(2_000).nullable().optional(),
  icon: icon.nullable().optional(),
  visibility: z.enum(['main', 'private', 'shareable']).optional(),
  isTemplate: z.boolean().optional(),
  folderId: z.uuid().nullable().optional(),
  ...neighbors,
});
export const BoardTemplatesResponse = z.object({
  builtin: z.array(
    z.object({
      kind: z.literal('builtin'),
      key: z.string(),
      name: z.string(),
      description: z.string(),
      icon: z.string(),
      boardKind: z.string(),
      groups: z.array(z.string()),
      columns: z.array(z.object({ title: z.string(), type: z.string() })),
    }),
  ),
  boards: z.array(
    z.object({
      kind: z.literal('board'),
      boardId: z.uuid(),
      name: z.string(),
      description: z.string().nullable(),
      icon: z.string().nullable(),
      boardKind: z.string(),
    }),
  ),
});
export const ChangesResponse = z.object({
  id: z.uuid(),
  changes: z.record(z.string(), z.unknown()),
});

export const FavoriteSchema = z.object({
  entityType: z.enum(['workspace', 'folder', 'board']),
  entityId: z.uuid(),
  name: z.string(),
  workspaceId: z.uuid(),
});
export const AddFavoriteBody = FavoriteParams;

/** `config` é validado por tipo no serviço (`parseViewConfig`); aqui só o shape de transporte. */
const viewConfig = z.record(z.string(), z.unknown());
export const ViewSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  type: z.enum(VIEW_TYPES),
  ownerId: z.uuid().nullable(),
  config: viewConfig,
  filters: FilterGroupSchema.nullable(),
  sort: ViewSortSchema,
  groupBy: ViewGroupBySchema.nullable(),
  hiddenColumnKeys: z.array(z.string()),
  isDefault: z.boolean(),
  isLocked: z.boolean(),
  isRestricted: z.boolean(),
  position: z.string(),
  personal: z.boolean(),
  canEdit: z.boolean(),
});
export const CreateViewBody = z
  .object({
    name,
    type: z.enum(VIEW_TYPES),
    personal: z.boolean().optional(),
    config: viewConfig.optional(),
    filters: FilterGroupSchema.nullable().optional(),
    sort: ViewSortSchema.optional(),
    groupBy: ViewGroupBySchema.nullable().optional(),
    hiddenColumnKeys: z.array(z.string().max(64)).max(300).optional(),
  })
  .strict();
export const UpdateViewBody = z
  .object({
    name: name.optional(),
    config: viewConfig.optional(),
    filters: FilterGroupSchema.nullable().optional(),
    sort: ViewSortSchema.optional(),
    groupBy: ViewGroupBySchema.nullable().optional(),
    hiddenColumnKeys: z.array(z.string().max(64)).max(300).optional(),
    isDefault: z.boolean().optional(),
    isLocked: z.boolean().optional(),
    isRestricted: z.boolean().optional(),
    ...neighbors,
  })
  .strict();
export const DuplicateViewBody = z
  .object({ name: name.optional(), personal: z.boolean().optional() })
  .strict();

// ------------------------------------------------------------------ Prompt 6: links públicos ---

const shareToken = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, 'Token inválido.');
export const ShareTokenParams = z.object({ token: shareToken });
const shareSettings = z.object({
  hiddenColumnKeys: z.array(z.string()),
  allowSearch: z.boolean(),
});
export const ShareLinkBody = z
  .object({
    /** `null` remove a senha; ausente mantém a atual. */
    password: z.string().min(4).max(128).nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    hiddenColumnKeys: z.array(z.string().max(64)).max(300).optional(),
    allowSearch: z.boolean().optional(),
    /** Troca o segredo do link (invalida o anterior); o token só volta na resposta quando `true`. */
    regenerateToken: z.boolean().optional(),
  })
  .strict();
export const ShareLinkResponse = z.object({
  token: z.string().nullable(),
  path: z.string(),
  requiresPassword: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  settings: shareSettings,
});
export const ShareLinkStatusResponse = z.object({
  exists: z.boolean(),
  requiresPassword: z.boolean().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  revokedAt: z.iso.datetime().nullable().optional(),
  accessCount: z.number().int().optional(),
  lastAccessedAt: z.iso.datetime().nullable().optional(),
  settings: shareSettings.optional(),
});
export const PublicShareInfoResponse = z.object({ requiresPassword: z.boolean() });
export const PublicVerifyBody = z.object({ password: z.string().max(128).optional() }).strict();
export const PublicVerifyResponse = z.object({
  shareToken: z.string(),
  boardId: z.uuid(),
  viewId: z.uuid(),
  expiresInSeconds: z.number().int(),
});
export const PublicLabelSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  color: z.string(),
  category: z.string(),
  position: z.string(),
});
export const PublicOptionSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  color: z.string().nullable(),
  position: z.string(),
});
export const PublicColumnSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  type: z.string(),
  title: z.string(),
  binding: z.string().nullable(),
  width: z.number().nullable(),
  labels: z.array(PublicLabelSchema),
  options: z.array(PublicOptionSchema),
});
export const PublicGroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  position: z.string(),
});
export const PublicBoardResponse = z.object({
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  viewType: z.enum(VIEW_TYPES),
  viewName: z.string(),
  groups: z.array(PublicGroupSchema),
  columns: z.array(PublicColumnSchema),
});
export const PublicItemSchema = z.object({
  id: z.uuid(),
  groupId: z.uuid(),
  name: z.string(),
  position: z.string(),
  values: z.record(z.string(), z.unknown()),
});
export const PublicItemsResponse = z.object({
  data: z.array(PublicItemSchema),
  truncated: z.boolean(),
});
export const PublicItemsQuery = z.object({ q: z.string().max(200).optional() });

// ------------------------------------------------------------------- Prompt 6: filtros salvos ---

export const SavedFilterSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  ownerId: z.uuid(),
  name: z.string(),
  filter: FilterGroupSchema,
  isShared: z.boolean(),
  mine: z.boolean(),
});
export const CreateSavedFilterBody = z
  .object({ name, filter: FilterGroupSchema, isShared: z.boolean().optional() })
  .strict();

// Reexportados para quem valida `config` por tipo fora deste módulo (ex.: duplicação de view).
export { KanbanConfigSchema, TableConfigSchema };

export const NotificationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(2_000).optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export const NotificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  boardId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  entityType: z.string().nullable(),
  entityId: z.uuid().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  actorAvatarUrl: z.string().nullable(),
});
export const NotificationPage = z.object({
  data: z.array(NotificationSchema),
  unreadCount: z.number().int(),
  pageInfo: z.object({ nextCursor: z.string().nullable(), hasNextPage: z.boolean() }),
});
export const MarkReadBody = z.object({ ids: z.array(z.uuid()).min(1).max(500).optional() });

export const NotificationPreferenceSchema = z.object({
  id: z.uuid(),
  channel: z.enum(['in_app', 'email', 'push']),
  eventType: z.string(),
  enabled: z.boolean(),
  frequency: z.enum(['instant', 'hourly', 'daily', 'never']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
/** `'weekly'` existe no enum do banco mas nenhuma rotina de digest a esvazia hoje (ADR 0051): fora da API. */
export const UpdateNotificationPreferencesBody = z
  .object({
    preferences: z
      .array(
        z.object({
          channel: z.enum(['in_app', 'email', 'push']),
          eventType: z.string().trim().min(1).max(100),
          enabled: z.boolean(),
          frequency: z.enum(['instant', 'hourly', 'daily', 'never']),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const WeekQuery = z.object({
  date: z.iso.date().optional(),
});
export const WeekSchema = z.object({
  from: z.string(),
  to: z.string(),
  data: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      boardId: z.uuid(),
      boardName: z.string(),
      workspaceId: z.uuid(),
      groupName: z.string(),
      dueDate: z.string(),
      overdue: z.boolean(),
    }),
  ),
});
