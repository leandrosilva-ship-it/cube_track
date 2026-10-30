import { Controller, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { InvoicesService } from '../application/invoices.service.js';
import { MeasurementsService } from '../application/measurements.service.js';
import * as S from './schemas.js';

/** Medição mensal e faturamento (ADR 0054): a medição consolida as OS aceitas do período; a fatura nasce de uma medição aprovada. */
@Controller()
export class BillingController {
  constructor(
    private readonly measurements: MeasurementsService,
    private readonly invoices: InvoicesService,
  ) {}

  // --------------------------------------------------------------------------------- medições ---

  @Get('contracts/:id/measurements')
  @Endpoint({
    summary: 'Listar medições do contrato',
    tags: ['contracts'],
    params: S.ContractParams,
    response: z.object({ data: z.array(S.MeasurementSchema) }),
  })
  async list(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ContractParams>) {
    return { data: await this.measurements.list(user, params.id) };
  }

  @Post('contracts/:id/measurements/generate')
  @Audited({ action: 'measurement.create', entityType: 'measurement' })
  @Endpoint({
    summary: 'Gerar medição do período (soma das OS aceitas no período — nunca digitada à mão)',
    description: 'Requer `contract.measure`.',
    tags: ['contracts'],
    status: 201,
    params: S.ContractParams,
    body: S.GenerateMeasurementBody,
    response: S.MeasurementSchema,
  })
  generate(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ContractParams>,
    @Input('body') body: z.infer<typeof S.GenerateMeasurementBody>,
  ) {
    return this.measurements.generate(user, params.id, body);
  }

  @Patch('measurements/:id')
  @Audited({ action: 'measurement.update', entityType: 'measurement' })
  @Endpoint({
    summary: 'Ajustar glosa/observações da medição (só enquanto não decidida)',
    tags: ['contracts'],
    params: S.MeasurementParams,
    body: S.UpdateMeasurementBody,
    response: S.MeasurementSchema,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.MeasurementParams>,
    @Input('body') body: z.infer<typeof S.UpdateMeasurementBody>,
  ) {
    return this.measurements.update(user, params.id, body);
  }

  @Post('measurements/:id/decide')
  @Audited({ action: 'measurement.decide', entityType: 'measurement' })
  @Endpoint({
    summary: 'Aprovar (recalcula approvedUst/amount) ou rejeitar a medição',
    tags: ['contracts'],
    params: S.MeasurementParams,
    body: S.DecideMeasurementBody,
    response: S.MeasurementSchema,
  })
  decide(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.MeasurementParams>,
    @Input('body') body: z.infer<typeof S.DecideMeasurementBody>,
  ) {
    return this.measurements.decide(user, params.id, body.status, body.notes);
  }

  // -------------------------------------------------------------------------------------- faturas ---

  @Get('contracts/:id/invoices')
  @Endpoint({
    summary: 'Listar faturas do contrato',
    tags: ['contracts'],
    params: S.ContractParams,
    response: z.object({ data: z.array(S.InvoiceSchema) }),
  })
  async listInvoices(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.ContractParams>) {
    return { data: await this.invoices.list(user, params.id) };
  }

  @Post('measurements/:id/invoice')
  @Audited({ action: 'invoice.create', entityType: 'invoice' })
  @Endpoint({
    summary: 'Faturar uma medição aprovada (herda valor e contrato da medição)',
    tags: ['contracts'],
    status: 201,
    params: S.MeasurementParams,
    body: S.CreateInvoiceBody,
    response: S.InvoiceSchema,
  })
  createInvoice(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.MeasurementParams>,
    @Input('body') body: z.infer<typeof S.CreateInvoiceBody>,
  ) {
    return this.invoices.createFromMeasurement(user, params.id, body);
  }

  @Patch('invoices/:id')
  @Audited({ action: 'invoice.update', entityType: 'invoice' })
  @Endpoint({
    summary: 'Atualizar dados da fatura (vencimento, chave de NF-e)',
    tags: ['contracts'],
    params: S.InvoiceParams,
    body: S.UpdateInvoiceBody,
    response: S.InvoiceSchema,
  })
  updateInvoice(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.InvoiceParams>,
    @Input('body') body: z.infer<typeof S.UpdateInvoiceBody>,
  ) {
    return this.invoices.update(user, params.id, body);
  }

  @Post('invoices/:id/transition')
  @Audited({ action: 'invoice.transition', entityType: 'invoice' })
  @Endpoint({
    summary: 'Transicionar status da fatura (emitida → paga/cancelada)',
    tags: ['contracts'],
    params: S.InvoiceParams,
    body: S.TransitionInvoiceBody,
    response: S.InvoiceSchema,
  })
  transitionInvoice(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.InvoiceParams>,
    @Input('body') body: z.infer<typeof S.TransitionInvoiceBody>,
  ) {
    return this.invoices.transition(user, params.id, body.to);
  }
}
