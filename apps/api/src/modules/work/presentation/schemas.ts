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
  phaseId: z.uuid().nullable(),
  phaseEnteredAt: z.string().nullable(),
  values: z.record(z.string(), z.unknown()),
  fieldVersions: z.record(z.string(), z.number().int()),
  version: z.number().int(),
  descriptionText: z.string().nullable(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  replannedStartDate: z.string().nullable(),
  replannedEndDate: z.string().nullable(),
  actualStartDate: z.string().nullable(),
  actualEndDate: z.string().nullable(),
  progress: z.string().nullable(),
  isMilestone: z.boolean(),
  scheduleMode: z.enum(['auto', 'manual']),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.uuid().nullable(),
  updatedBy: z.uuid().nullable(),
  archivedAt: z.string().nullable(),
  indicators: z
    .object({
      subitems: z.number().int(),
      attachments: z.number().int(),
      updates: z.number().int(),
      unreadUpdates: z.number().int(),
    })
    .optional(),
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
  search: z.string().max(200).optional(),
  archivedOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  indicators: z
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
  description: z.string().trim().max(20_000).nullable().optional(),
  isMilestone: z.boolean().optional(),
  scheduleMode: z.enum(['auto', 'manual']).optional(),
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
    description: z.string().trim().max(20_000).nullable().optional(),
    isMilestone: z.boolean().optional(),
    scheduleMode: z.enum(['auto', 'manual']).optional(),
  })
  .strict();

export const BoardParams = z.object({ boardId: z.uuid() });
export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const ColumnParams = z.object({ boardId: z.uuid(), columnId: z.uuid() });

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
  icon: z.string().nullable(),
  visibility: z.string(),
  terminology: z.object({ singular: z.string(), plural: z.string() }),
  settings: z.record(z.string(), z.unknown()),
  isTemplate: z.boolean(),
  seq: z.number().int(),
  /** Contrato (ADR 0054) ao qual este board está vinculado, se o módulo `contracts` estiver em uso. */
  contractId: z.uuid().nullable(),
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
      requiredWhen: z.record(z.string(), z.unknown()).nullable(),
      defaultValue: z.record(z.string(), z.unknown()).nullable(),
      isHidden: z.boolean(),
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

// ------------------------------------------------------------------- Prompt 5: Tabela e colunas ---

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const principalList = z
  .object({
    roleIds: z.array(z.uuid()).max(100).optional(),
    userIds: z.array(z.uuid()).max(1000).optional(),
    teamIds: z.array(z.uuid()).max(100).optional(),
  })
  .strict();
const ColumnPermissionsBody = z
  .object({ viewers: principalList.optional(), editors: principalList.optional() })
  .strict();
const ColumnPositionBody = z
  .object({ afterKey: z.string().optional(), beforeKey: z.string().optional() })
  .strict();
const LabelBody = z
  .object({
    id: z.uuid().optional(),
    label: z.string().trim().min(1).max(60),
    color,
    category: z.enum(['not_started', 'in_progress', 'done', 'stuck']),
  })
  .strict();
const OptionBody = z
  .object({
    id: z.uuid().optional(),
    label: z.string().trim().min(1).max(120),
    color: color.nullable().optional(),
  })
  .strict();

export const CreateColumnBody = z
  .object({
    type: z.string().min(1).max(40),
    title: z.string().trim().min(1).max(120),
    description: z.string().max(1000).nullable().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    width: z.number().int().min(40).max(2000).nullable().optional(),
    position: ColumnPositionBody.optional(),
    labels: z
      .array(LabelBody.omit({ id: true }))
      .max(40)
      .optional(),
    options: z
      .array(OptionBody.omit({ id: true }))
      .max(500)
      .optional(),
    isRequired: z.boolean().optional(),
    requiredWhen: FilterGroupSchema.nullable().optional(),
    permissions: ColumnPermissionsBody.optional(),
  })
  .strict();

export const UpdateColumnBody = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(1000).nullable().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    width: z.number().int().min(40).max(2000).nullable().optional(),
    position: ColumnPositionBody.optional(),
    isRequired: z.boolean().optional(),
    isHidden: z.boolean().optional(),
    requiredWhen: FilterGroupSchema.nullable().optional(),
    defaultValue: z.record(z.string(), z.unknown()).nullable().optional(),
    permissions: ColumnPermissionsBody.optional(),
  })
  .strict();

export const ColumnRefResponse = z.object({ id: z.uuid(), key: z.string() });
export const ReplaceLabelsBody = z.object({ labels: z.array(LabelBody).min(1).max(40) }).strict();
export const ReplaceOptionsBody = z.object({ options: z.array(OptionBody).max(500) }).strict();
export const DuplicateColumnBody = z.object({ includeValues: z.boolean().default(true) }).strict();
export const StatusColumnBody = z.object({ statusColumnKey: z.string().min(1) }).strict();

const GroupPositionBody = z
  .object({ afterId: z.uuid().optional(), beforeId: z.uuid().optional() })
  .strict();
export const GroupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  position: z.string(),
  isCollapsed: z.boolean(),
  archivedAt: z.string().nullable().optional(),
});
export const CreateGroupBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    color: color.optional(),
    position: GroupPositionBody.optional(),
  })
  .strict();
export const UpdateGroupBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    color: color.optional(),
    isCollapsed: z.boolean().optional(),
    archived: z.boolean().optional(),
    position: GroupPositionBody.optional(),
  })
  .strict();
export const DuplicateGroupBody = z.object({ includeItems: z.boolean().default(true) }).strict();
const ColumnMapping = z.record(z.string(), z.string().nullable());
export const MoveGroupBody = z.object({ boardId: z.uuid(), columnMapping: ColumnMapping }).strict();
export const GroupParams = z.object({ groupId: z.uuid() });

export const BulkUpdateBody = z
  .object({
    items: z
      .array(UpdateItemBody.extend({ id: z.uuid() }))
      .min(1)
      .max(500),
  })
  .strict();
export const ItemListResponse = z.object({ data: z.array(ItemSchema) });

const itemIds = z.array(z.uuid()).min(1).max(500);
export const ItemActionBody = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('duplicate'), itemIds, includeSubitems: z.boolean().optional() })
    .strict(),
  z.object({ action: z.enum(['archive', 'unarchive', 'delete', 'restore']), itemIds }).strict(),
  z
    .object({
      action: z.literal('move'),
      itemIds,
      target: z
        .object({ boardId: z.uuid(), groupId: z.uuid(), columnMapping: ColumnMapping.optional() })
        .strict(),
    })
    .strict(),
]);
export const ItemActionResponse = z.object({ items: z.array(ItemSchema) });

export const TrashResponse = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      groupId: z.uuid(),
      groupName: z.string(),
      parentItemId: z.uuid().nullable(),
      deletedAt: z.string().nullable(),
      deletedBy: z.uuid().nullable(),
      expiresAt: z.string().nullable(),
    }),
  ),
  groups: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      color: z.string(),
      deletedAt: z.string().nullable(),
      expiresAt: z.string().nullable(),
    }),
  ),
});

export const TimerParams = z.object({ id: z.uuid(), columnKey: z.string().min(1).max(64) });
export const TimerBody = z.object({ action: z.enum(['start', 'stop']) }).strict();
export const DependenciesResponse = z.object({
  data: z.array(
    z.object({
      id: z.uuid(),
      predecessorId: z.uuid(),
      successorId: z.uuid(),
      type: z.enum(['FS', 'SS', 'FF', 'SF']),
      lagDays: z.number().int(),
    }),
  ),
});
export const SetDependenciesBody = z
  .object({
    predecessors: z
      .array(
        z
          .object({
            itemId: z.uuid(),
            type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
            lagDays: z.number().int().min(-3650).max(3650).default(0),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const locale = z.enum(['pt-BR', 'en', 'es']).default('pt-BR');
export const ImportUploadBody = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    contentBase64: z.string().min(1).max(14_000_000),
  })
  .strict();
const ImportTarget = z.union([
  z.literal('name'),
  z.literal('group'),
  z.templateLiteral(['column:', z.string()]),
  z.null(),
]);
export const ImportPreviewResponse = z.object({
  importId: z.uuid(),
  fileName: z.string(),
  headers: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  totalRows: z.number().int(),
  suggestedMapping: z.record(z.string(), ImportTarget),
});
export const ImportParams = z.object({ boardId: z.uuid(), importId: z.uuid() });
export const ImportCommitBody = z
  .object({
    mapping: z.record(z.string(), ImportTarget),
    groupId: z.uuid(),
    createMissing: z.boolean().default(false),
    locale,
  })
  .strict();
export const ImportResultResponse = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(
    z.object({ row: z.number().int(), column: z.string().nullable(), message: z.string() }),
  ),
});
export const ExportQuery = z.object({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  locale,
  filter: jsonFilter.optional(),
  sort: sortParam.optional(),
  search: z.string().max(200).optional(),
});
