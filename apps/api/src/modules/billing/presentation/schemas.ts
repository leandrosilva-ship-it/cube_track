import { PaymentRecordSchema, PlanTierSchema, SubscriptionSchema, UsageSchema } from '@cube-track/shared';
import { z } from 'zod';

export const SubscriptionOverviewResponse = z.object({
  subscription: SubscriptionSchema,
  usage: UsageSchema,
  plan: z.object({
    tier: PlanTierSchema,
    label: z.string(),
    priceBRL: z.string(),
    modules: z.array(z.string()),
    limits: z.object({
      maxSeats: z.number().int().nullable(),
      maxBoardsPerWorkspace: z.number().int().nullable(),
      maxItemsPerBoard: z.number().int().nullable(),
      maxStorageBytes: z.number().int().nullable(),
    }),
  }),
});

export const PaymentHistoryResponse = z.object({ data: z.array(PaymentRecordSchema) });

export const CheckoutResultResponse = z.discriminatedUnion('kind', [
  z.object({
    method: z.literal('card'),
    kind: z.literal('redirect'),
    redirectUrl: z.string(),
    stripeSessionId: z.string(),
    stripeCustomerId: z.null(),
  }),
  z.object({
    method: z.literal('pix'),
    kind: z.literal('pix'),
    qrPayload: z.string(),
    referenceId: z.string(),
    expiresAt: z.date(),
  }),
  z.object({
    method: z.literal('boleto'),
    kind: z.literal('boleto'),
    barcode: z.string(),
    referenceId: z.string(),
    dueAt: z.date(),
  }),
]);

export const OverridePlanBody = z.object({ plan: PlanTierSchema });

export const StripeWebhookResponse = z.object({
  received: z.literal(true),
  handled: z.boolean(),
  eventType: z.string(),
});
