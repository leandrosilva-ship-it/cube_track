import { Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { HealthRulesService } from '../application/health-rules.service.js';
import { StatusReportService } from '../application/status-report.service.js';
import * as S from './schemas.js';

/** Regras de saúde (RAG automático) e status report sob demanda (ADR 0053). */
@Controller()
export class HealthController {
  constructor(
    private readonly healthRules: HealthRulesService,
    private readonly statusReport: StatusReportService,
  ) {}

  @Get('health-rules/default')
  @Endpoint({
    summary: 'Regras de saúde padrão do tenant',
    tags: ['portfolio'],
    response: S.HealthRuleSetResponseSchema,
  })
  getDefaultRules(@CurrentPrincipal() user: AuthPrincipal) {
    return this.healthRules.getDefault(user);
  }

  @Put('health-rules/default')
  @Audited({ action: 'health_rule_set.set_default', entityType: 'health_rule_set' })
  @Endpoint({
    summary: 'Salvar as regras de saúde padrão do tenant',
    description: 'Requer `portfolio.manage`.',
    tags: ['portfolio'],
    body: S.SetHealthRuleSetBody,
    response: S.HealthRuleSetResponseSchema,
  })
  setDefaultRules(@CurrentPrincipal() user: AuthPrincipal, @Input('body') body: z.infer<typeof S.SetHealthRuleSetBody>) {
    return this.healthRules.setDefault(user, body.rules);
  }

  @Get('boards/:boardId/health-rules')
  @Endpoint({
    summary: 'Regras de saúde efetivas do projeto (próprias ou o padrão do tenant)',
    tags: ['portfolio'],
    params: S.BoardParams,
    response: S.HealthRuleSetResponseSchema,
  })
  getBoardRules(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return this.healthRules.getForBoard(user, params.boardId);
  }

  @Put('boards/:boardId/health-rules')
  @Audited({ action: 'health_rule_set.set', entityType: 'health_rule_set' })
  @Endpoint({
    summary: 'Salvar regras de saúde próprias do projeto',
    description: 'Requer `board.manage`.',
    tags: ['portfolio'],
    params: S.BoardParams,
    body: S.SetHealthRuleSetBody,
    response: S.HealthRuleSetResponseSchema,
  })
  setBoardRules(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardParams>,
    @Input('body') body: z.infer<typeof S.SetHealthRuleSetBody>,
  ) {
    return this.healthRules.setForBoard(user, params.boardId, body.rules);
  }

  @Get('boards/:boardId/status-report')
  @Endpoint({
    summary: 'Status report do projeto: saúde, EVM, orçamento, riscos/issues abertos, stage gates',
    description: 'Exportação em PDF é feita no cliente (mesmo padrão de Gantt/Dashboards).',
    tags: ['portfolio'],
    params: S.BoardParams,
    response: S.BoardStatusReportSchema,
  })
  boardStatusReport(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.BoardParams>) {
    return this.statusReport.forBoard(user, params.boardId);
  }

  @Get('portfolios/:id/status-report')
  @Endpoint({
    summary: 'Status report do portfólio: rollup agregado',
    tags: ['portfolio'],
    params: S.IdParams,
    response: S.RollupResponseSchema,
  })
  async portfolioStatusReport(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return (await this.statusReport.forPortfolio(user, params.id)).rollup;
  }

  @Get('programs/:id/status-report')
  @Endpoint({
    summary: 'Status report do programa: rollup agregado',
    tags: ['portfolio'],
    params: S.IdParams,
    response: S.RollupResponseSchema,
  })
  async programStatusReport(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: z.infer<typeof S.IdParams>) {
    return (await this.statusReport.forProgram(user, params.id)).rollup;
  }
}
