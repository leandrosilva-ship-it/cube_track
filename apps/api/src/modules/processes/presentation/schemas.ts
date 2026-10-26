import { z } from 'zod';

export const BoardParams = z.object({ boardId: z.uuid() });
export const PipeParams = z.object({ pipeId: z.uuid() });

const phaseKind = z.enum(['start', 'intermediate', 'done', 'cancelled']);
const positionBody = z
  .object({ afterId: z.uuid().optional(), beforeId: z.uuid().optional() })
  .strict()
  .optional();

export const PipeSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PhaseSchema = z.object({
  id: z.uuid(),
  pipeId: z.uuid(),
  groupId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  kind: phaseKind,
  requiredColumnKeys: z.array(z.string()),
  formId: z.uuid().nullable(),
  wipLimit: z.number().int().nullable(),
  position: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TransitionRuleSchema = z.object({
  id: z.uuid(),
  pipeId: z.uuid(),
  fromPhaseId: z.uuid().nullable(),
  toPhaseId: z.uuid(),
  conditions: z.record(z.string(), z.unknown()).nullable(),
  requiredColumnKeys: z.array(z.string()),
  allowedRoleIds: z.array(z.uuid()),
  requiresApproval: z.boolean(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProcessConfigSchema = z.object({
  pipe: PipeSchema.nullable(),
  phases: z.array(PhaseSchema),
  transitionRules: z.array(TransitionRuleSchema),
});

export const CreatePipeBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export const UpdatePipeBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const CreatePhaseBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2_000).nullable().optional(),
    kind: phaseKind.optional(),
    requiredColumnKeys: z.array(z.string()).max(50).optional(),
    formId: z.uuid().nullable().optional(),
    wipLimit: z.number().int().positive().nullable().optional(),
    position: positionBody,
  })
  .strict();

export const UpdatePhaseBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    kind: phaseKind.optional(),
    requiredColumnKeys: z.array(z.string()).max(50).optional(),
    formId: z.uuid().nullable().optional(),
    wipLimit: z.number().int().positive().nullable().optional(),
    position: positionBody,
  })
  .strict();

export const TransitionRuleBody = z
  .object({
    fromPhaseId: z.uuid().nullable().optional(),
    toPhaseId: z.uuid(),
    conditions: z.record(z.string(), z.unknown()).nullable().optional(),
    requiredColumnKeys: z.array(z.string()).max(50).optional(),
    allowedRoleIds: z.array(z.uuid()).max(50).optional(),
    requiresApproval: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export const UpdateTransitionRuleBody = z
  .object({
    fromPhaseId: z.uuid().nullable().optional(),
    toPhaseId: z.uuid().optional(),
    conditions: z.record(z.string(), z.unknown()).nullable().optional(),
    requiredColumnKeys: z.array(z.string()).max(50).optional(),
    allowedRoleIds: z.array(z.uuid()).max(50).optional(),
    requiresApproval: z.boolean().optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export const SlaSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  pipeId: z.uuid().nullable(),
  phaseId: z.uuid().nullable(),
  name: z.string(),
  targetMinutes: z.number().int(),
  warningPercent: z.number().int(),
  useBusinessTime: z.boolean(),
  workCalendarId: z.uuid().nullable(),
  startCondition: z.record(z.string(), z.unknown()).nullable(),
  stopCondition: z.record(z.string(), z.unknown()).nullable(),
  pauseCondition: z.record(z.string(), z.unknown()).nullable(),
  isEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const SlaTrackerSchema = z.object({
  id: z.uuid(),
  slaId: z.uuid(),
  itemId: z.uuid(),
  status: z.enum(['running', 'paused', 'met', 'breached', 'stopped']),
  startedAt: z.string(),
  dueAt: z.string(),
  warningAt: z.string().nullable(),
});

export const CreateSlaBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    targetMinutes: z.number().int().positive(),
    warningPercent: z.number().int().min(1).max(100).optional(),
    useBusinessTime: z.boolean().optional(),
    workCalendarId: z.uuid().nullable().optional(),
    pipeId: z.uuid().nullable().optional(),
    phaseId: z.uuid().nullable().optional(),
    startCondition: z.record(z.string(), z.unknown()).nullable().optional(),
    stopCondition: z.record(z.string(), z.unknown()).nullable().optional(),
    pauseCondition: z.record(z.string(), z.unknown()).nullable().optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export const UpdateSlaBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    targetMinutes: z.number().int().positive().optional(),
    warningPercent: z.number().int().min(1).max(100).optional(),
    useBusinessTime: z.boolean().optional(),
    workCalendarId: z.uuid().nullable().optional(),
    pipeId: z.uuid().nullable().optional(),
    phaseId: z.uuid().nullable().optional(),
    startCondition: z.record(z.string(), z.unknown()).nullable().optional(),
    stopCondition: z.record(z.string(), z.unknown()).nullable().optional(),
    pauseCondition: z.record(z.string(), z.unknown()).nullable().optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();
