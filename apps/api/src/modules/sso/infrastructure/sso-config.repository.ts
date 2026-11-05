import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import { eq } from 'drizzle-orm';

const { ssoConfigurations } = schema;

export type SsoConfigRow = typeof ssoConfigurations.$inferSelect;

/** Leitura/escrita de `sso_configurations` — uma linha por tenant (ADR 0057). */
@Injectable()
export class SsoConfigRepository {
  async find(tx: Transaction, tenantId: string): Promise<SsoConfigRow | null> {
    const [row] = await tx
      .select()
      .from(ssoConfigurations)
      .where(eq(ssoConfigurations.tenantId, tenantId));
    return row ?? null;
  }

  async upsert(
    tx: Transaction,
    tenantId: string,
    values: Omit<typeof ssoConfigurations.$inferInsert, 'tenantId'>,
  ): Promise<SsoConfigRow> {
    const [row] = await tx
      .insert(ssoConfigurations)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({
        target: ssoConfigurations.tenantId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao salvar a configuração de SSO.');
    return row;
  }
}
