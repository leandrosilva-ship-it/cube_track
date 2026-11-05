import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { newId } from '@cube-track/shared';

import { planTier, tenantStatus } from './_enums.js';

/** Organização (tenant). Raiz do isolamento — RLS: `id = app.current_tenant_id()`. */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_v7()`)
      .$defaultFn(newId),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    legalName: text('legal_name'),
    document: text('document'),
    /** Plano de billing (Prompt 16, ADR 0059) — restrito a `PLAN_TIERS`, catálogo de preço/limites
     * em `@cube-track/shared/billing`. Novo tenant nasce `'free'`; o tenant de demonstração é
     * provisionado explicitamente como `'enterprise'` (`seed/demo.ts`) para não ficar sujeito aos
     * limites do Free nos testes/seed. */
    plan: planTier('plan').notNull().default('free'),
    status: tenantStatus('status').notNull().default('active'),
    locale: text('locale').notNull().default('pt-BR'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    currency: text('currency').notNull().default('BRL'),
    dataRegion: text('data_region').notNull().default('br'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('tenants_slug_key').on(t.slug)],
);
