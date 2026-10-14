import { FilterGroupSchema, PageQuerySchema, parseSort } from '@cube-track/shared';
import { z } from 'zod';

import { pageSchema } from '../../../core/http/schemas.js';

export const ItemSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  groupId: z.uuid(),
  parentItemId: z.uuid().nullable(),
  name: z.string(),
  position: z.string(),
  values: z.record(z.string(), z.unknown()),
  fieldVersions: z.record(z.string(), z.number().int()),
  version: z.number().int(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  replannedStartDate: z.string().nullable(),
  replannedEndDate: z.string().nullable(),
  actualStartDate: z.string().nullable(),
  actualEndDate: z.string().nullable(),
  progress: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
  redactedFields: z.array(z.string()),
});
export const ItemPageSchema = pageSchema(ItemSchema);

const jsonFilter = z
  .string()
  .max(10_000)
  .transform((raw, context) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      context.addIssue({ code: 'custom', message: 'Filtro deve ser JSON válido.' });
      return z.NEVER;
    }
  })
  .pipe(FilterGroupSchema);

const sortParam = z
  .string()
  .max(200)
  .transform((raw, context) => {
    try {
      return parseSort(raw);
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Ordenação inválida.',
      });
      return z.NEVER;
    }
  });

export const ListItemsQuery = PageQuerySchema.extend({
  filter: jsonFilter.optional(),
  sort: sortParam.optional(),
  groupId: z.uuid().optional(),
  parentItemId: z.uuid().optional(),
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const PositionSchema = z
  .object({ afterId: z.uuid().optional(), beforeId: z.uuid().optional() })
  .refine(
    (value) => !(value.afterId !== undefined && value.beforeId !== undefined),
    'Use afterId OU beforeId.',
  );

const date = z.iso.date().nullable();
export const NativeFieldsSchema = z
  .object({
    plannedStartDate: date,
    plannedEndDate: date,
    replannedStartDate: date,
    replannedEndDate: date,
    actualStartDate: date,
    actualEndDate: date,
    progress: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/)
      .nullable(),
  })
  .partial()
  .strict();

export const CreateItemBody = z.object({
  groupId: z.uuid(),
  name: z.string().trim().min(1).max(500),
  parentItemId: z.uuid().optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  fields: NativeFieldsSchema.optional(),
  position: PositionSchema.optional(),
});

export const UpdateItemBody = z
  .object({
    name: z.string().trim().min(1).max(500).optional(),
    groupId: z.uuid().optional(),
    position: PositionSchema.optional(),
    values: z.record(z.string(), z.unknown()).optional(),
    fields: NativeFieldsSchema.optional(),
    baseVersions: z.record(z.string(), z.number().int().nonnegative()).optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const BoardParams = z.object({ boardId: z.uuid() });
export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const ColumnParams = z.object({ boardId: z.uuid(), columnId: z.uuid() });

export const UpdateColumnBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    width: z.number().int().min(40).max(2000).nullable().optional(),
    isRequired: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    permissions: z
      .object({
        viewers: z
          .object({
            roleIds: z.array(z.uuid()).optional(),
            userIds: z.array(z.uuid()).optional(),
            teamIds: z.array(z.uuid()).optional(),
          })
          .optional(),
        editors: z
          .object({
            roleIds: z.array(z.uuid()).optional(),
            userIds: z.array(z.uuid()).optional(),
            teamIds: z.array(z.uuid()).optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .strict();

export const EventsQuery = z.object({ after: z.coerce.number().int().nonnegative() });

export const WorkspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  visibility: z.enum(['open', 'closed']),
  enabledModules: z.array(z.string()),
});

export const BoardSummarySchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  folderId: z.uuid().nullable(),
  kind: z.enum(['board', 'project', 'process', 'backlog']),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(['main', 'private', 'shareable']),
  isTemplate: z.boolean(),
});

export const BoardDetailSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  folderId: z.uuid().nullable(),
  kind: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.string(),
  terminology: z.object({ singular: z.string(), plural: z.string() }),
  seq: z.number().int(),
  permissions: z.array(z.string()),
  itemScope: z.enum(['all', 'assigned']),
  groups: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      color: z.string(),
      position: z.string(),
      isCollapsed: z.boolean(),
    }),
  ),
  columns: z.array(
    z.object({
      id: z.uuid(),
      key: z.string(),
      type: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      settings: z.record(z.string(), z.unknown()),
      binding: z.string().nullable(),
      isRequired: z.boolean(),
      position: z.string(),
      width: z.number().nullable(),
      permissions: z.record(z.string(), z.unknown()),
      canEdit: z.boolean(),
      labels: z.array(
        z
          .object({
            id: z.uuid(),
            label: z.string(),
            color: z.string(),
            category: z.string(),
            position: z.string(),
          })
          .loose(),
      ),
      options: z.array(
        z
          .object({
            id: z.uuid(),
            label: z.string(),
            color: z.string().nullable(),
            position: z.string(),
          })
          .loose(),
      ),
    }),
  ),
});

export const EventsResponse = z.object({
  events: z.array(z.record(z.string(), z.unknown())),
  resyncRequired: z.boolean(),
  seq: z.number().int(),
});
