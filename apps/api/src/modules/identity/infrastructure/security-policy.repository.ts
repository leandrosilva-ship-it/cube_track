import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import {
  DEFAULT_SECURITY_POLICY,
  SecurityPolicySchema,
  type SecurityPolicy,
} from '@cube-track/shared';
import { eq } from 'drizzle-orm';

const { securityPolicies } = schema;

/**
 * Leitura/escrita da política de segurança do tenant (ADR 0057) — uma linha por tenant, sub-formas
 * JSONB validadas por Zod. Ausência de linha, ou de uma sub-chave, nunca é "sem política": é sempre
 * `DEFAULT_SECURITY_POLICY` (padrões seguros definidos em `@cube-track/shared/security`).
 */
@Injectable()
export class SecurityPolicyRepository {
  async find(tx: Transaction, tenantId: string): Promise<SecurityPolicy> {
    const [row] = await tx
      .select()
      .from(securityPolicies)
      .where(eq(securityPolicies.tenantId, tenantId));
    if (row === undefined) return DEFAULT_SECURITY_POLICY;
    return SecurityPolicySchema.catch(DEFAULT_SECURITY_POLICY).parse({
      password: row.passwordPolicy,
      session: row.sessionPolicy,
      accessRestriction: row.accessRestriction,
    });
  }

  async upsert(
    tx: Transaction,
    tenantId: string,
    policy: SecurityPolicy,
    updatedBy: string,
  ): Promise<void> {
    await tx
      .insert(securityPolicies)
      .values({
        tenantId,
        passwordPolicy: policy.password,
        sessionPolicy: policy.session,
        accessRestriction: policy.accessRestriction,
        updatedBy,
      })
      .onConflictDoUpdate({
        target: securityPolicies.tenantId,
        set: {
          passwordPolicy: policy.password,
          sessionPolicy: policy.session,
          accessRestriction: policy.accessRestriction,
          updatedBy,
          updatedAt: new Date(),
        },
      });
  }
}
