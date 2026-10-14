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

export const CreateBoardBody = z.object({
  name,
  description: z.string().max(2_000).optional(),
  folderId: z.uuid().nullable().optional(),
  kind: z.enum(['board', 'project', 'process', 'backlog']).optional(),
  visibility: z.enum(['main', 'private', 'shareable']).optional(),
});
export const UpdateBoardBody = z.object({
  name: name.optional(),
  description: z.string().max(2_000).nullable().optional(),
  folderId: z.uuid().nullable().optional(),
  ...neighbors,
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

export const VIEW_TYPES = [
  'table',
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'form',
  'map',
  'chart',
  'files',
  'workload',
  'dashboard',
] as const;
export const ViewSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  type: z.enum(VIEW_TYPES),
  ownerId: z.uuid().nullable(),
  isDefault: z.boolean(),
  isLocked: z.boolean(),
  isRestricted: z.boolean(),
  position: z.string(),
  personal: z.boolean(),
  canEdit: z.boolean(),
});
export const CreateViewBody = z.object({
  name,
  type: z.enum(VIEW_TYPES),
  personal: z.boolean().optional(),
});
export const UpdateViewBody = z.object({ name: name.optional(), ...neighbors });

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
