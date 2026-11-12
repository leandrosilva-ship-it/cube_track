import { Inject, Injectable } from '@nestjs/common';
import { schema, type DatabaseHandle, type Transaction } from '@cube-track/db';
import type { PaymentMethod, PaymentRecordStatus, PlanTier, SubscriptionStatus } from '@cube-track/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

import { APP_DB } from '../../../core/database/tokens.js';

const { attachmentVersions, invitations, memberships, paymentRecords, subscriptions, tenants } = schema;

export interface SubscriptionRow {
  id: string;
  tenantId: string;
  plan: PlanTier;
  status: SubscriptionStatus;
  paymentMethod: PaymentMethod;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionPatch {
  plan?: PlanTier;
  status?: SubscriptionStatus;
  paymentMethod?: PaymentMethod;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
}

@Injectable()
export class BillingRepository {
  constructor(@Inject(APP_DB) private readonly database: DatabaseHandle) {}

  async loadSubscription(tx: Transaction, tenantId: string): Promise<SubscriptionRow | null> {
    const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
    return row ?? null;
  }

  async loadSubscriptionForUpdate(
    tx: Transaction,
    tenantId: string,
  ): Promise<SubscriptionRow | null> {
    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .for('update');
    return row ?? null;
  }

  /** Atualiza `subscriptions` E `tenants.plan` na MESMA transação (ADR 0059: `tenants.plan` é o
   * espelho rápido usado pelas guardas de limite; `subscriptions` é o registro de billing — nunca
   * divergem). */
  async applyPatch(tx: Transaction, tenantId: string, patch: SubscriptionPatch): Promise<SubscriptionRow> {
    const [row] = await tx
      .update(subscriptions)
      .set(patch)
      .where(eq(subscriptions.tenantId, tenantId))
      .returning();
    if (row === undefined) throw new Error(`Assinatura não encontrada para o tenant ${tenantId}`);
    if (patch.plan !== undefined) {
      await tx.update(tenants).set({ plan: patch.plan }).where(eq(tenants.id, tenantId));
    }
    return row;
  }

  async insertPaymentRecord(
    tx: Transaction,
    input: {
      tenantId: string;
      subscriptionId: string;
      amount: string;
      currency: string;
      status: PaymentRecordStatus;
      method: PaymentMethod;
      providerReferenceId: string | null;
      description: string;
      paidAt: Date | null;
      createdBy: string | null;
    },
  ): Promise<string> {
    // O índice único (`payment_records_tenant_provider_ref_key`) é PARCIAL
    // (`where provider_reference_id is not null`, 0038) — sem `targetWhere` repetindo o mesmo
    // predicado, o Postgres recusa o `ON CONFLICT` ("no unique or exclusion constraint matching").
    // `.returning({ id })`: o chamador usa o UUID da linha (nunca o id do provedor, que não é UUID)
    // como `entityId` da auditoria/evento de domínio.
    const [row] = await tx
      .insert(paymentRecords)
      .values(input)
      .onConflictDoUpdate({
        target: [paymentRecords.tenantId, paymentRecords.providerReferenceId],
        targetWhere: sql`${paymentRecords.providerReferenceId} is not null`,
        set: { status: input.status, paidAt: input.paidAt },
      })
      .returning({ id: paymentRecords.id });
    if (row === undefined) throw new Error('Falha ao gravar o registro de cobrança.');
    return row.id;
  }

  /** Vagas em uso: membros ativos + convites pendentes (`kind: 'member'`) — nunca um contador em
   * cache/coluna, sempre `COUNT` em tempo real (ADR 0059). */
  async countSeats(tx: Transaction, tenantId: string): Promise<number> {
    const [activeMembers] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(eq(memberships.tenantId, tenantId), eq(memberships.kind, 'member'), isNull(memberships.deletedAt)),
      );
    const [pendingInvites] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(invitations)
      .where(
        and(
          eq(invitations.tenantId, tenantId),
          eq(invitations.kind, 'member'),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      );
    return (activeMembers?.count ?? 0) + (pendingInvites?.count ?? 0);
  }

  async sumStorageBytes(tx: Transaction, tenantId: string): Promise<number> {
    // `::bigint` pode exceder o range de `int4`; o driver `pg` devolve `bigint` como string, daí
    // `sql<string>` (não `<number>`) e a conversão explícita abaixo — nunca `::int` aqui (ao
    // contrário das contagens acima), por poder passar de 2^31-1 bytes num tenant grande.
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${attachmentVersions.sizeBytes}), 0)::bigint` })
      .from(attachmentVersions)
      .where(eq(attachmentVersions.tenantId, tenantId));
    return Number(row?.total ?? '0');
  }

  /**
   * Resolve o tenant dono de uma assinatura pelo id de cliente/assinatura do Stripe — chamado pelo
   * webhook público ANTES de haver contexto de tenant (RLS), via `app.resolve_subscription_by_stripe_id`
   * (SECURITY DEFINER, 0038_billing_rls_and_resolver.sql). Mesmo padrão de
   * `MailInboundService.resolveTenant` (`app.resolve_item_for_reply`).
   */
  async resolveTenantByStripeIds(
    customerId: string | null,
    subscriptionId: string | null,
  ): Promise<{ tenantId: string; subscriptionId: string } | null> {
    const result = await this.database.db.execute<{ tenant_id: string; subscription_id: string }>(
      sql`select * from app.resolve_subscription_by_stripe_id(${customerId}::text, ${subscriptionId}::text)`,
    );
    const row = result.rows[0];
    return row === undefined ? null : { tenantId: row.tenant_id, subscriptionId: row.subscription_id };
  }
}
