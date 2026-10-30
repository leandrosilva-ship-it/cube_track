import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, asc, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { ContractsService } from './contracts.service.js';
import { MeasurementsService } from './measurements.service.js';

const { invoices } = schema;

type InvoiceRow = typeof invoices.$inferSelect;
type InvoiceStatus = InvoiceRow['status'];

export interface InvoiceDto {
  id: string;
  contractId: string;
  measurementId: string | null;
  number: string;
  issueDate: string;
  dueDate: string | null;
  amount: string;
  status: InvoiceStatus;
  paidAt: string | null;
  nfeKey: string | null;
}

export interface CreateInvoiceInput {
  number: string;
  dueDate?: string | null | undefined;
  nfeKey?: string | null | undefined;
}

export interface UpdateInvoiceInput {
  dueDate?: string | null | undefined;
  nfeKey?: string | null | undefined;
}

function toDto(row: InvoiceRow): InvoiceDto {
  return {
    id: row.id,
    contractId: row.contractId,
    measurementId: row.measurementId,
    number: row.number,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    amount: row.amount,
    status: row.status,
    paidAt: row.paidAt,
    nfeKey: row.nfeKey,
  };
}

/**
 * Fatura (ADR 0054): criada a partir de uma medição **aprovada** — herda `contractId` e `amount` da
 * medição (nunca digitado à mão), nasce `issued` (o ato de criar o registro é o próprio faturamento,
 * `issueDate` = hoje). Transições: `issued → paid`, `issued → cancelled` (terminal: `paid`/`cancelled`).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly contracts: ContractsService,
    private readonly measurements: MeasurementsService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, contractId: string): Promise<InvoiceDto[]> {
    await this.contracts.assertRead(user, contractId);
    const rows = await this.runner.tx
      .select()
      .from(invoices)
      .where(eq(invoices.contractId, contractId))
      .orderBy(asc(invoices.issueDate));
    return rows.map(toDto);
  }

  async createFromMeasurement(user: AuthPrincipal, measurementId: string, input: CreateInvoiceInput): Promise<InvoiceDto> {
    const measurement = await this.measurements.locked(measurementId);
    await this.contracts.assertManage(user, measurement.contractId);
    if (measurement.status !== 'approved' || measurement.amount === null)
      throw new UnprocessableError('Só é possível faturar uma medição aprovada.', 'measurement_not_approved');
    const [existingInvoice] = await this.runner.tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.measurementId, measurementId), eq(invoices.status, 'issued')));
    if (existingInvoice !== undefined) throw new ConflictError('Esta medição já tem uma fatura ativa.');
    const [existingNumber] = await this.runner.tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.contractId, measurement.contractId), eq(invoices.number, input.number)));
    if (existingNumber !== undefined) throw new ConflictError('Já existe uma fatura com este número neste contrato.');
    const today = new Date().toISOString().slice(0, 10);
    const [row] = await this.runner.tx
      .insert(invoices)
      .values({
        tenantId: user.tenantId,
        contractId: measurement.contractId,
        measurementId,
        number: input.number,
        issueDate: today,
        dueDate: input.dueDate ?? null,
        amount: measurement.amount,
        status: 'issued',
        nfeKey: input.nfeKey ?? null,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar fatura.');
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateInvoiceInput): Promise<InvoiceDto> {
    const existing = await this.locked(id);
    await this.contracts.assertManage(user, existing.contractId);
    const [row] = await this.runner.tx
      .update(invoices)
      .set({
        dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate,
        nfeKey: input.nfeKey === undefined ? existing.nfeKey : input.nfeKey,
      })
      .where(eq(invoices.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar fatura.');
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  async transition(user: AuthPrincipal, id: string, to: InvoiceStatus): Promise<InvoiceDto> {
    const existing = await this.locked(id);
    await this.contracts.assertManage(user, existing.contractId);
    const allowed: Record<InvoiceStatus, InvoiceStatus[]> = {
      draft: ['issued', 'cancelled'],
      issued: ['paid', 'cancelled'],
      paid: [],
      cancelled: [],
    };
    if (!allowed[existing.status].includes(to))
      throw new UnprocessableError(`Não é possível mudar o status de "${existing.status}" para "${to}".`, 'invalid_transition');
    const today = new Date().toISOString().slice(0, 10);
    const [row] = await this.runner.tx
      .update(invoices)
      .set({ status: to, paidAt: to === 'paid' ? today : existing.paidAt })
      .where(eq(invoices.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao transicionar fatura.');
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  private async locked(id: string): Promise<InvoiceRow> {
    const [row] = await this.runner.tx.select().from(invoices).where(eq(invoices.id, id));
    if (row === undefined) throw new NotFoundError('Fatura');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<InvoiceRow, 'id' | 'contractId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'invoice.changed',
      aggregateType: 'invoice',
      aggregateId: row.id,
      payload: { invoiceId: row.id, contractId: row.contractId, change },
      actorId: user.userId,
    });
  }
}

export type { InvoiceRow, InvoiceStatus };
