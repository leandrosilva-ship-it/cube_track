/**
 * Catálogo de planos (Prompt 16, ADR 0059): Free/Pro/Business/Enterprise, limites por plano e
 * estado de assinatura/cobrança. Puro e síncrono — sem I/O, sem `node:crypto` (por isso faz parte
 * do barrel principal; a verificação de assinatura do webhook Stripe, que PRECISA de `node:crypto`,
 * fica isolada em `./billing-webhook.ts`, fora do barrel, mesmo motivo de `crypto.ts`/
 * `integrations.ts` — ver `index.ts`).
 *
 * `tenants.plan` (ADR 0059) deixou de ser texto livre decorativo: agora é restrito a `PLAN_TIERS` e
 * o catálogo abaixo é a fonte única de verdade de preço/limites/módulos de cada plano, usada pela
 * API (checkout, guardas de limite) e pelo frontend (tela de planos, avisos de limite).
 */
import { z } from 'zod';

import { OPTIONAL_WORKSPACE_MODULES, type OptionalWorkspaceModule } from './modules.js';

export const PLAN_TIERS = ['free', 'pro', 'business', 'enterprise'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export function isPlanTier(value: string): value is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(value);
}

export const PlanTierSchema = z.enum(PLAN_TIERS);

/** Estado da assinatura (espelha o objeto `Subscription` do Stripe, mais `'none'` para o plano
 * Free, que nunca passa pelo Stripe). */
export const SUBSCRIPTION_STATUSES = [
  'none',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);

/** `pix`/`boleto` usam o adaptador stub (lacuna documentada em `docs/billing.md`) — nunca um PSP
 * real neste ambiente. `none` é o método do plano Free (nunca cobrado). */
export const PAYMENT_METHODS = ['card', 'pix', 'boleto', 'none'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);

export const PAYMENT_RECORD_STATUSES = ['pending', 'paid', 'failed', 'refunded'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];
export const PaymentRecordStatusSchema = z.enum(PAYMENT_RECORD_STATUSES);

// --------------------------------------------------------------------------------- catálogo ---

export interface PlanLimits {
  /** Máximo de membros ativos + convites pendentes (`kind: 'member'`); convidados externos não
   * contam. `null` = sem limite (Enterprise). */
  maxSeats: number | null;
  /** Máximo de boards por workspace. `null` = sem limite. */
  maxBoardsPerWorkspace: number | null;
  /** Máximo de itens (não arquivados/excluídos) por board. `null` = sem limite. */
  maxItemsPerBoard: number | null;
  /** Máximo de armazenamento de arquivos somado no tenant inteiro (soma de
   * `attachment_versions.size_bytes`), em bytes. `null` = sem limite. */
  maxStorageBytes: number | null;
}

export interface PlanDefinition {
  tier: PlanTier;
  label: string;
  /** Preço mensal em BRL, decimal string (CLAUDE.md §5: dinheiro nunca é `float`). `'0.00'` no Free. */
  priceBRL: string;
  /** Módulos opcionais incluídos no plano — hoje informativo (usado pela tela de planos e por
   * avisos de upgrade); o controle real de ativação continua sendo `workspaces.enabled_modules`
   * (ADR 0017), que o próprio tenant liga/desliga — ver `docs/billing.md` §4. */
  modules: readonly OptionalWorkspaceModule[];
  limits: PlanLimits;
}

const BYTES_PER_GB = 1024 ** 3;

export const PLAN_CATALOG: Record<PlanTier, PlanDefinition> = {
  free: {
    tier: 'free',
    label: 'Free',
    priceBRL: '0.00',
    modules: ['agile'],
    limits: { maxSeats: 5, maxBoardsPerWorkspace: 3, maxItemsPerBoard: 200, maxStorageBytes: 1 * BYTES_PER_GB },
  },
  pro: {
    tier: 'pro',
    label: 'Pro',
    priceBRL: '49.90',
    modules: ['agile', 'schedule', 'resources'],
    limits: {
      maxSeats: 20,
      maxBoardsPerWorkspace: 20,
      maxItemsPerBoard: 5_000,
      maxStorageBytes: 20 * BYTES_PER_GB,
    },
  },
  business: {
    tier: 'business',
    label: 'Business',
    priceBRL: '149.90',
    modules: ['agile', 'process', 'schedule', 'resources', 'portfolio'],
    limits: {
      maxSeats: 100,
      maxBoardsPerWorkspace: null,
      maxItemsPerBoard: 50_000,
      maxStorageBytes: 200 * BYTES_PER_GB,
    },
  },
  enterprise: {
    tier: 'enterprise',
    label: 'Enterprise',
    priceBRL: '0.00',
    modules: [...OPTIONAL_WORKSPACE_MODULES],
    limits: { maxSeats: null, maxBoardsPerWorkspace: null, maxItemsPerBoard: null, maxStorageBytes: null },
  },
};

/** Enterprise é sob consulta/contrato (`priceBRL: '0.00'` acima é um placeholder, nunca cobrado
 * automaticamente) — a UI de planos mostra "Fale com vendas" em vez de um preço quando `true`. */
export function isCustomPricedPlan(tier: PlanTier): boolean {
  return tier === 'enterprise';
}

/** Hoje só informativo (ver `PlanDefinition.modules`) — não é chamado por `assertModuleEnabled`. */
export function planIncludesModule(tier: PlanTier, module: OptionalWorkspaceModule): boolean {
  return PLAN_CATALOG[tier].modules.includes(module);
}

// --------------------------------------------------------------------------- limites (puro) ---

/** `true` quando mais uma vaga (`additional`, padrão 1) ainda cabe no limite do plano. */
export function isWithinSeatLimit(tier: PlanTier, currentSeats: number, additional = 1): boolean {
  const { maxSeats } = PLAN_CATALOG[tier].limits;
  if (maxSeats === null) return true;
  return currentSeats + additional <= maxSeats;
}

/** `true` quando `additionalItems` (padrão 1) ainda cabem no limite de itens do board do plano. */
export function isWithinItemLimit(tier: PlanTier, currentItems: number, additionalItems = 1): boolean {
  const { maxItemsPerBoard } = PLAN_CATALOG[tier].limits;
  if (maxItemsPerBoard === null) return true;
  return currentItems + additionalItems <= maxItemsPerBoard;
}

/** `true` quando `currentBoards` (sem contar o novo) ainda cabe mais um board no workspace do plano. */
export function isWithinBoardLimit(tier: PlanTier, currentBoards: number, additional = 1): boolean {
  const { maxBoardsPerWorkspace } = PLAN_CATALOG[tier].limits;
  if (maxBoardsPerWorkspace === null) return true;
  return currentBoards + additional <= maxBoardsPerWorkspace;
}

/** `true` quando `usedBytes + additionalBytes` ainda cabe no limite de armazenamento do plano. */
export function isWithinStorageLimit(tier: PlanTier, usedBytes: number, additionalBytes: number): boolean {
  const { maxStorageBytes } = PLAN_CATALOG[tier].limits;
  if (maxStorageBytes === null) return true;
  return usedBytes + additionalBytes <= maxStorageBytes;
}

// --------------------------------------------------------------------------------- schemas ---

export const SubscriptionSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  plan: PlanTierSchema,
  status: SubscriptionStatusSchema,
  paymentMethod: PaymentMethodSchema,
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  currentPeriodStart: z.iso.datetime().nullable(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionSchema>;

export const PaymentRecordSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  subscriptionId: z.uuid(),
  /** Decimal string (BRL), nunca `float` (CLAUDE.md §5). */
  amount: z.string(),
  currency: z.string().length(3),
  status: PaymentRecordStatusSchema,
  method: PaymentMethodSchema,
  providerReferenceId: z.string().nullable(),
  description: z.string(),
  issuedAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
});
export type PaymentRecordDto = z.infer<typeof PaymentRecordSchema>;

export const CreateCheckoutSessionBodySchema = z.object({
  plan: PlanTierSchema,
  /** `'none'` nunca é um método válido de checkout (só reflete o plano Free sem assinatura). */
  method: z.enum(['card', 'pix', 'boleto']),
});
export type CreateCheckoutSessionBody = z.infer<typeof CreateCheckoutSessionBodySchema>;

export const UpdatePlanBodySchema = z.object({ plan: PlanTierSchema });
export type UpdatePlanBody = z.infer<typeof UpdatePlanBodySchema>;

export const UsageSchema = z.object({
  seats: z.number().int().nonnegative(),
  storageBytes: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;
