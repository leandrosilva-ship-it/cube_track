import { Module } from '@nestjs/common';

import { BudgetsService } from './application/budgets.service.js';
import { HealthRulesService } from './application/health-rules.service.js';
import { IssuesService } from './application/issues.service.js';
import { PortfoliosService } from './application/portfolios.service.js';
import { ProgramsService } from './application/programs.service.js';
import { RisksService } from './application/risks.service.js';
import { RollupService } from './application/rollup.service.js';
import { ScoringService } from './application/scoring.service.js';
import { StageGatesService } from './application/stage-gates.service.js';
import { StatusReportService } from './application/status-report.service.js';
import { WhatIfService } from './application/what-if.service.js';
import { BudgetController } from './presentation/budget.controller.js';
import { GovernanceController } from './presentation/governance.controller.js';
import { HealthController } from './presentation/health.controller.js';
import { PortfolioController } from './presentation/portfolio.controller.js';

/**
 * Gestão de portfólio (ADR 0053): hierarquia Portfólio → Programa → Projeto com rollup, priorização
 * (scoring/WSJF, matriz valor×esforço, ranking), stage gates, riscos/issues, orçamento/EVM e what-if.
 * RAG automático e status report dependem de `ResourcesModule` (permissão de workspace principal) só
 * indiretamente — nenhuma importação cruzada de módulo é necessária (usa o utilitário puro
 * `primaryWorkspaceId`, não um provider do módulo).
 */
@Module({
  controllers: [PortfolioController, GovernanceController, BudgetController, HealthController],
  providers: [
    PortfoliosService,
    ProgramsService,
    ScoringService,
    StageGatesService,
    RisksService,
    IssuesService,
    BudgetsService,
    HealthRulesService,
    RollupService,
    WhatIfService,
    StatusReportService,
  ],
})
export class PortfolioModule {}
