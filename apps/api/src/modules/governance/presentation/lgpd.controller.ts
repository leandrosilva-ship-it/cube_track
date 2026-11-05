import { Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { LgpdService } from '../application/lgpd.service.js';
import * as S from './lgpd.schemas.js';

/** LGPD: consentimento e solicitações de titular (ADR 0057). Autosserviço (`me/lgpd/*`) — a
 * administração (listar todas as solicitações, decidir, executar) fica em `AdminLgpdController`. */
@Controller('me/lgpd')
export class LgpdController {
  constructor(private readonly lgpd: LgpdService) {}

  @Post('consents')
  @Audited({ action: 'lgpd.consent_recorded', entityType: 'consent_record' })
  @Endpoint({
    summary: 'Registrar uma decisão de consentimento (LGPD)',
    tags: ['lgpd'],
    body: S.RecordConsentBody,
    status: 201,
  })
  recordConsent(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.RecordConsentBody>,
  ) {
    return this.lgpd.recordConsent(user, body);
  }

  @Get('consents')
  @Endpoint({
    summary: 'Meu histórico de consentimento (LGPD)',
    tags: ['lgpd'],
    response: z.object({ data: z.array(S.ConsentSchema) }),
  })
  async myConsents(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.lgpd.myConsents(user) };
  }

  @Post('requests')
  @Audited({ action: 'lgpd.request_created', entityType: 'data_subject_request' })
  @Endpoint({
    summary: 'Solicitar exportação ou exclusão dos meus dados (LGPD)',
    description: 'Exportação é executada de imediato; exclusão entra em fluxo de aprovação.',
    tags: ['lgpd'],
    body: S.CreateRequestBody,
    response: S.RequestSchema,
    status: 201,
  })
  createRequest(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.CreateRequestBody>,
  ) {
    return this.lgpd.createRequest(user, { kind: body.kind, reason: body.reason ?? null });
  }

  @Get('requests')
  @Endpoint({
    summary: 'Minhas solicitações de titular (LGPD)',
    tags: ['lgpd'],
    response: z.object({ data: z.array(S.RequestSchema) }),
  })
  async myRequests(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.lgpd.myRequests(user) };
  }

  @Get('export')
  @Endpoint({
    summary: 'Exportar meus dados pessoais (LGPD, portabilidade)',
    description: 'Ver `outOfScope` na resposta para o que ainda não está incluído.',
    tags: ['lgpd'],
    response: S.PersonalDataExportSchema,
  })
  exportData(@CurrentPrincipal() user: AuthPrincipal) {
    return this.lgpd.exportPersonalData(user);
  }
}

/** Administração LGPD (`lgpd.manage`): todas as solicitações do tenant, decisão e execução. */
@Controller('lgpd/requests')
export class AdminLgpdController {
  constructor(private readonly lgpd: LgpdService) {}

  @Get()
  @Endpoint({
    summary: 'Listar todas as solicitações de titular do tenant (LGPD)',
    description: 'Requer `lgpd.manage`.',
    tags: ['lgpd'],
    response: z.object({ data: z.array(S.RequestSchema) }),
  })
  async list(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.lgpd.listAllRequests(user) };
  }

  @Post(':id/decide')
  @Audited({ action: 'lgpd.request_decided', entityType: 'data_subject_request' })
  @Endpoint({
    summary: 'Aprovar ou rejeitar uma solicitação de exclusão (LGPD)',
    description: 'Requer `lgpd.manage`.',
    tags: ['lgpd'],
    params: S.IdParams,
    body: S.DecideRequestBody,
    response: S.RequestSchema,
    status: 200,
  })
  decide(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
    @Input('body') body: z.infer<typeof S.DecideRequestBody>,
  ) {
    return this.lgpd.decide(user, params.id, {
      status: body.status,
      decisionNote: body.decisionNote ?? null,
    });
  }

  @Post(':id/execute')
  @Audited({ action: 'lgpd.request_executed', entityType: 'data_subject_request' })
  @Endpoint({
    summary: 'Executar uma solicitação de exclusão APROVADA (anonimiza o usuário)',
    description: 'Requer `lgpd.manage`.',
    tags: ['lgpd'],
    params: S.IdParams,
    response: S.RequestSchema,
    status: 200,
  })
  execute(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.IdParams>,
  ) {
    return this.lgpd.execute(user, params.id);
  }
}
