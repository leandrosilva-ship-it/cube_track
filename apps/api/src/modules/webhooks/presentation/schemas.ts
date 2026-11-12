import { z } from 'zod';

import { checkWebhookUrl } from '../domain/webhook-url-policy.js';

/**
 * https + checagem de SSRF (esquema/host literal — ver `../domain/webhook-url-policy.ts`). Não
 * substitui a revalidação por DNS feita pelo worker em cada tentativa de entrega.
 */
function webhookUrl() {
  return z.url().superRefine((url, ctx) => {
    if (!url.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', message: 'A URL precisa ser https.' });
      return;
    }
    const check = checkWebhookUrl(url);
    if (!check.allowed) {
      ctx.addIssue({ code: 'custom', message: check.reason ?? 'URL de webhook não permitida.' });
    }
  });
}

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
    url: webhookUrl(),
    events: z.array(z.string()).min(1).max(50),
    headers: z.record(z.string(), z.string()).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();

export const WebhookDeliverySchema = z.object({
  id: z.uuid(),
  webhookId: z.uuid(),
  eventId: z.uuid(),
  eventType: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed', 'dead']),
  attempt: z.number().int(),
  responseStatus: z.number().int().nullable(),
  responseBody: z.string().nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
  resentFromId: z.uuid().nullable(),
});

export const UpdateWebhookBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    url: webhookUrl().optional(),
    events: z.array(z.string()).min(1).max(50).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    isEnabled: z.boolean().optional(),
  })
  .strict();
