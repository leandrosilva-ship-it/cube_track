import { AI_FEATURES, AI_MODELS, AI_PROVIDERS, AUTOMATION_ACTION_TYPES } from '@cube-track/shared';
import { z } from 'zod';

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });
export const ItemParams = z.object({ itemId: z.uuid() });
export const AgentParams = z.object({ id: z.uuid() });
export const RunParams = z.object({ id: z.uuid() });

const TriggerBody = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

const ActionBody = z.object({
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).default({}),
});

// ------------------------------------------------------------------------------ configuração ---

export const AiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.enum(AI_MODELS),
  enabled: z.boolean(),
  hasApiKey: z.boolean(),
  monthlyTokenLimit: z.number().int().nullable(),
  monthlyCostLimitCents: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
});

export const UpdateAiSettingsBody = z
  .object({
    provider: z.enum(AI_PROVIDERS).optional(),
    apiKey: z.string().trim().min(8).max(500).optional(),
    model: z.enum(AI_MODELS).optional(),
    enabled: z.boolean().optional(),
    monthlyTokenLimit: z.number().int().min(0).nullable().optional(),
    monthlyCostLimitCents: z.number().int().min(0).nullable().optional(),
  })
  .strict();

export const AiUsageEntrySchema = z.object({
  feature: z.enum(AI_FEATURES),
  tokens: z.number().int(),
  costCents: z.number().int(),
  calls: z.number().int(),
});

// --------------------------------------------------------------------------------- assistente ---

export const AskAssistantBody = z.object({ question: z.string().trim().min(1).max(2_000) }).strict();
export const AssistantResponseSchema = z.object({
  answer: z.string(),
  toolCalls: z.array(z.string()),
  usage: z.object({ inputTokens: z.number().int(), outputTokens: z.number().int() }),
});

export const CreateItemFromTextBody = z
  .object({ text: z.string().trim().min(1).max(10_000), groupId: z.uuid().optional() })
  .strict();

export const SummaryResponseSchema = z.object({ summary: z.string() });
export const DescriptionResponseSchema = z.object({ description: z.string() });

export const DelayRiskEntrySchema = z.object({
  itemId: z.uuid(),
  name: z.string(),
  dueDate: z.string(),
  status: z.enum(['overdue', 'due_soon']),
});
export const AssigneeSuggestionSchema = z.object({
  itemId: z.uuid(),
  name: z.string(),
  suggestedUserId: z.uuid(),
  suggestedUserName: z.string(),
  reason: z.string(),
});
export const DuplicateCandidateSchema = z.object({
  itemIdA: z.uuid(),
  nameA: z.string(),
  itemIdB: z.uuid(),
  nameB: z.string(),
  similarity: z.number(),
});
export const PredictionsResponseSchema = z.object({
  narrative: z.string(),
  delayRisk: z.array(DelayRiskEntrySchema),
  assigneeSuggestions: z.array(AssigneeSuggestionSchema),
  duplicates: z.array(DuplicateCandidateSchema),
});

// ------------------------------------------------------------------------------------ agentes ---

export const AiAgentSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  boardId: z.uuid().nullable(),
  name: z.string(),
  instructions: z.string(),
  trigger: TriggerBody,
  allowedActions: z.array(z.enum(AUTOMATION_ACTION_TYPES)),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateAiAgentBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    instructions: z.string().trim().min(1).max(4_000),
    trigger: TriggerBody,
    allowedActions: z.array(z.enum(AUTOMATION_ACTION_TYPES)).min(1).max(3),
    isActive: z.boolean().optional(),
  })
  .strict();

export const UpdateAiAgentBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    instructions: z.string().trim().min(1).max(4_000).optional(),
    trigger: TriggerBody.optional(),
    allowedActions: z.array(z.enum(AUTOMATION_ACTION_TYPES)).min(1).max(3).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const AiAgentRunSchema = z.object({
  id: z.uuid(),
  agentId: z.uuid(),
  boardId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  status: z.enum(['pending_approval', 'approved', 'rejected', 'executed', 'failed', 'reverted']),
  reasoning: z.string(),
  proposedAction: ActionBody,
  beforeSnapshot: z.record(z.string(), z.unknown()).nullable(),
  costCents: z.number().int(),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.uuid().nullable(),
  decisionNote: z.string().nullable(),
  executedAt: z.string().nullable(),
  revertedAt: z.string().nullable(),
  revertedBy: z.uuid().nullable(),
});

export const DecideRunBody = z.object({ note: z.string().trim().max(2_000).optional() }).strict();
