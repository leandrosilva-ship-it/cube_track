import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { eq } from 'drizzle-orm';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { assertSeatLimit } from '../domain/seat-limit.js';
import { BillingRepository } from '../infrastructure/billing.repository.js';

const { tenants } = schema;

/**
 * Serviço público do módulo de billing (ADR 0059) consumido por OUTROS módulos (identidade) —
 * mesma convenção de acesso entre módulos do CLAUDE.md §5 ("um módulo só acessa outro pela sua API
 * pública"). Usado pelo fluxo de convite (`InvitationService.create`) para impedir ultrapassar o
 * limite de vagas do plano ANTES de criar o convite — nunca depois.
 */
@Injectable()
export class SeatLimitService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly repository: BillingRepository,
  ) {}

  /**
   * Lança `ConflictError` (409, `seat_limit_exceeded`) quando mais `additional` vaga(s) de membro
   * não cabem no plano do tenant. Deve rodar DENTRO da transação corrente do chamador (o convite é
   * `@Audited` transacional) — nunca abre uma transação própria.
   */
  async assertCanAddMembers(tenantId: string, additional = 1): Promise<void> {
    const tx = this.runner.tx;
    const [tenant] = await tx.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId));
    const plan = tenant?.plan ?? 'free';
    const currentSeats = await this.repository.countSeats(tx, tenantId);
    assertSeatLimit(plan, currentSeats, additional);
  }
}
