import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { CONSUMING_ORDER_STATUSES, computeInvoiceAmount, reconcileMeasurement } from '@cube-track/shared';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnprocessableError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { ContractsService } from './contracts.service.js';

const { measurements, serviceOrders } = schema;

type MeasurementRow = typeof measurements.$inferSelect;

export interface MeasurementDto {
  id: string;
  contractId: string;
  periodStart: string;
  periodEnd: string;
  measuredUst: string;
  glosaUst: string;
  approvedUst: string | null;
  amount: string | null;
  status: MeasurementRow['status'];
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
}

export interface GenerateMeasurementInput {
  periodStart: string;
  periodEnd: string;
}

export interface UpdateMeasurementInput {
  glosaUst?: string | undefined;
  notes?: string | null | undefined;
}

function toDto(row: MeasurementRow): MeasurementDto {
  return {
    id: row.id,
    contractId: row.contractId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    measuredUst: row.measuredUst,
    glosaUst: row.glosaUst,
    approvedUst: row.approvedUst,
    amount: row.amount,
    status: row.status,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    notes: row.notes,
  };
}

/**
 * Medição mensal (ADR 0054): `measuredUst` é sempre a soma real das OS **aceitas** (ou além —
 * `CONSUMING_ORDER_STATUSES`) do contrato cuja `acceptedAt` cai no período — nunca digitado à mão.
 * É isso que faz "o relatório confere com a soma dos itens" ser verdade por construção
 * (`reconcileMeasurement`, mesmo motor usado nos testes unitários do pacote compartilhado).
 * Fluxo: `generate` (rascunho) → `update` (ajusta glosa/observações) → `decide` (aprova, recalculando
 * `approvedUst`/`amount`, ou rejeita).
 */
@Injectable()
export class MeasurementsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly contracts: ContractsService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, contractId: string): Promise<MeasurementDto[]> {
    await this.contracts.assertRead(user, contractId);
    const rows = await this.runner.tx
      .select()
      .from(measurements)
      .where(eq(measurements.contractId, contractId))
      .orderBy(asc(measurements.periodStart));
    return rows.map(toDto);
  }

  async generate(user: AuthPrincipal, contractId: string, input: GenerateMeasurementInput): Promise<MeasurementDto> {
    await this.contracts.assertMeasure(user, contractId);
    if (input.periodEnd < input.periodStart)
      throw new ValidationError([{ path: 'body.periodEnd', message: 'O fim não pode ser antes do início.' }]);
    const orders = await this.runner.tx
      .select({ id: serviceOrders.id, totalUst: serviceOrders.totalUst })
      .from(serviceOrders)
      .where(
        and(
          eq(serviceOrders.contractId, contractId),
          isNull(serviceOrders.deletedAt),
          inArray(serviceOrders.status, CONSUMING_ORDER_STATUSES),
          gte(serviceOrders.acceptedAt, input.periodStart),
          lte(serviceOrders.acceptedAt, input.periodEnd),
        ),
      );
    const { measuredUst } = reconcileMeasurement({
      orderUstTotals: orders.map((order) => Number(order.totalUst)),
      glosaUst: 0,
    });
    const [row] = await this.runner.tx
      .insert(measurements)
      .values({
        tenantId: user.tenantId,
        contractId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        measuredUst: measuredUst.toString(),
        glosaUst: '0',
        status: 'draft',
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao gerar medição.');
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateMeasurementInput): Promise<MeasurementDto> {
    const existing = await this.locked(id);
    await this.contracts.assertMeasure(user, existing.contractId);
    this.assertEditable(existing);
    const glosaUst = input.glosaUst ?? existing.glosaUst;
    if (Number(glosaUst) > Number(existing.measuredUst))
      throw new ValidationError([{ path: 'body.glosaUst', message: 'A glosa não pode ser maior que a UST medida.' }]);
    const [row] = await this.runner.tx
      .update(measurements)
      .set({ glosaUst, notes: input.notes === undefined ? existing.notes : input.notes })
      .where(eq(measurements.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar medição.');
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  async decide(user: AuthPrincipal, id: string, status: 'approved' | 'rejected', notes?: string | null): Promise<MeasurementDto> {
    const existing = await this.locked(id);
    const contract = await this.contracts.assertMeasure(user, existing.contractId);
    this.assertEditable(existing);
    const { approvedUst } = reconcileMeasurement({
      orderUstTotals: [Number(existing.measuredUst)],
      glosaUst: Number(existing.glosaUst),
    });
    const isApproved = status === 'approved';
    const amount = isApproved ? computeInvoiceAmount(approvedUst, Number(contract.ustUnitPrice)) : null;
    const [row] = await this.runner.tx
      .update(measurements)
      .set({
        status,
        approvedUst: isApproved ? approvedUst.toString() : null,
        amount: amount === null ? null : amount.toString(),
        approvedBy: isApproved ? user.userId : null,
        approvedAt: isApproved ? new Date() : null,
        notes: notes === undefined ? existing.notes : notes,
      })
      .where(eq(measurements.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao decidir medição.');
    await this.emitChanged(user, row, isApproved ? 'approved' : 'rejected');
    return toDto(row);
  }

  async locked(id: string): Promise<MeasurementRow> {
    const [row] = await this.runner.tx.select().from(measurements).where(eq(measurements.id, id));
    if (row === undefined) throw new NotFoundError('Medição');
    return row;
  }

  private assertEditable(existing: MeasurementRow): void {
    if (existing.status !== 'draft' && existing.status !== 'submitted')
      throw new UnprocessableError('Esta medição já foi decidida.', 'measurement_already_decided');
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<MeasurementRow, 'id' | 'contractId'>,
    change: 'created' | 'updated' | 'approved' | 'rejected',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'measurement.changed',
      aggregateType: 'measurement',
      aggregateId: row.id,
      payload: { measurementId: row.id, contractId: row.contractId, change },
      actorId: user.userId,
    });
  }
}

export type { MeasurementRow };
