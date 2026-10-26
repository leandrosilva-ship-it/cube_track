import { z } from 'zod';

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });

const TriggerBody = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});
const ActionBody = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

export const AutomationSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  boardId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  trigger: TriggerBody,
  conditions: z.record(z.string(), z.unknown()).nullable(),
  actions: z.array(ActionBody),
  isEnabled: z.boolean(),
  ownerId: z.uuid().nullable(),
  templateKey: z.string().nullable(),
  runCount: z.number().int(),
  errorCount: z.number().int(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateAutomationBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().optional(),
    trigger: TriggerBody,
    conditions: z.record(z.string(), z.unknown()).nullable().optional(),
    actions: z.array(ActionBody).min(1).max(20),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export const UpdateAutomationBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    trigger: TriggerBody.optional(),
    conditions: z.record(z.string(), z.unknown()).nullable().optional(),
    actions: z.array(ActionBody).min(1).max(20).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();
