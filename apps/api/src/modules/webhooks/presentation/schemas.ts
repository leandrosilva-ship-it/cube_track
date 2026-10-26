import { z } from 'zod';

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });

export const WebhookSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  boardId: z.uuid().nullable(),
  name: z.string(),
  url: z.url(),
  events: z.array(z.string()),
  headers: z.record(z.string(), z.string()),
  isEnabled: z.boolean(),
  consecutiveFailures: z.number().int(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Só na criação e na regeneração: o segredo em texto simples (nunca mais é devolvido). */
export const WebhookWithSecretSchema = WebhookSchema.extend({ secret: z.string() });

export const CreateWebhookBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: z.url().refine((url) => url.startsWith('https://'), 'A URL precisa ser https.'),
    events: z.array(z.string()).min(1).max(50),
    headers: z.record(z.string(), z.string()).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export const UpdateWebhookBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    url: z
      .url()
      .refine((url) => url.startsWith('https://'), 'A URL precisa ser https.')
      .optional(),
    events: z.array(z.string()).min(1).max(50).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();
