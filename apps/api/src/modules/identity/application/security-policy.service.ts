import { Injectable } from '@nestjs/common';
import {
  AccessRestrictionPolicySchema,
  PasswordPolicySchema,
  SecurityPolicySchema,
  SessionPolicySchema,
  type AccessRestrictionPolicy,
  type PasswordPolicy,
  type SecurityPolicy,
  type SessionPolicy,
} from '@cube-track/shared';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { SecurityPolicyRepository } from '../infrastructure/security-policy.repository.js';

/** Como `Partial<T>`, mas compatível com `exactOptionalPropertyTypes` quando o chamador (corpo Zod
 * `.partial()`) tipa cada campo ausente como `X | undefined` explicitamente, não só opcional. */
type Loose<T> = { [K in keyof T]?: T[K] | undefined };

export interface UpdateSecurityPolicyInput {
  password?: Loose<PasswordPolicy> | undefined;
  session?: Loose<SessionPolicy> | undefined;
  accessRestriction?: Loose<AccessRestrictionPolicy> | undefined;
}

/**
 * Política de segurança do tenant (ADR 0057): senha, sessão e allowlist de IP/domínio — lida por
 * `AuthService`/`SessionService`/`AuthGuard` em todo login e requisição, escrita só por
 * `security_policy.manage`. Leitura é permitida a qualquer membro autenticado (não expõe segredo
 * algum, só regras), diferente de `AiSettingsService`/SSO que escondem a chave/certificado.
 */
@Injectable()
export class SecurityPolicyService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly repository: SecurityPolicyRepository,
    private readonly events: DomainEvents,
  ) {}

  async get(user: AuthPrincipal): Promise<SecurityPolicy> {
    return this.repository.find(this.runner.tx, user.tenantId);
  }

  /** Mesma leitura, mas sem `AuthPrincipal` (usada no login, antes da sessão existir) — chamada
   * sempre dentro de `TransactionRunner.run({ tenantId, userId })`, nunca fora de uma transação. */
  async forTenant(tenantId: string): Promise<SecurityPolicy> {
    return this.repository.find(this.runner.tx, tenantId);
  }

  async update(user: AuthPrincipal, input: UpdateSecurityPolicyInput): Promise<SecurityPolicy> {
    await this.access.assert(user, 'security_policy.manage', { type: 'tenant' });
    const current = await this.repository.find(this.runner.tx, user.tenantId);
    const next = SecurityPolicySchema.parse({
      password: PasswordPolicySchema.parse({ ...current.password, ...input.password }),
      session: SessionPolicySchema.parse({ ...current.session, ...input.session }),
      accessRestriction: AccessRestrictionPolicySchema.parse({
        ...current.accessRestriction,
        ...input.accessRestriction,
      }),
    });
    await this.repository.upsert(this.runner.tx, user.tenantId, next, user.userId);
    const changed: ('password' | 'session' | 'accessRestriction')[] = [];
    if (input.password !== undefined) changed.push('password');
    if (input.session !== undefined) changed.push('session');
    if (input.accessRestriction !== undefined) changed.push('accessRestriction');
    this.events.recordChange({
      action: 'security_policy.update',
      entityType: 'security_policy',
      entityId: user.tenantId,
      before: current,
      after: next,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'security_policy.changed',
      aggregateType: 'security_policy',
      aggregateId: user.tenantId,
      payload: { changed },
      actorId: user.userId,
    });
    return next;
  }
}
