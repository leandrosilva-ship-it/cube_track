import { TEMPLATE_KINDS } from '@cube-track/shared';
import { z } from 'zod';

export const TemplateKindSchema = z.enum(TEMPLATE_KINDS);
export const BoardIdParams = z.object({ boardId: z.uuid() });

export const TemplateSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid().nullable(),
  kind: TemplateKindSchema,
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  usageCount: z.number().int(),
  isGlobal: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TemplateListQuery = z.object({
  kind: TemplateKindSchema.optional(),
  scope: z.enum(['internal', 'public']).optional(),
});

export const CreateTemplateBody = z
  .object({
    kind: TemplateKindSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    category: z.string().trim().max(60).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const UpdateTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.string().trim().max(60).nullable().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** O corpo real varia por `kind` do template (validado dentro do serviço, caso a caso). */
export const ApplyTemplateBody = z.record(z.string(), z.unknown());

export const ApplyTemplateResponse = z.object({
  kind: TemplateKindSchema,
  // Ids dos recursos criados — conteúdo varia por `kind` (ex.: `{boardId}`, `{workspaceId, boardIds}`).
  created: z.record(z.string(), z.unknown()),
});

export const SaveBoardAsTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    category: z.string().trim().max(60).optional(),
    includeItems: z.boolean(),
  })
  .strict();
