import { schema } from '@cube-track/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDb,
  client,
  demoIds,
  resetRateLimits,
  startApi,
  DEMO_TENANT_ID,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

const { projectHealth } = schema;

interface Portfolio {
  id: string;
  workspaceId: string;
  name: string;
}
interface Program {
  id: string;
  workspaceId: string;
  portfolioId: string | null;
  name: string;
}
interface ScoringModel {
  id: string;
  method: 'weighted' | 'wsjf';
  criteria: { key: string; label: string; weight: number; scaleMin: number; scaleMax: number; higherIsBetter: boolean }[];
}
interface Score {
  boardId: string;
  totalScore: string;
}
interface StageGate {
  id: string;
  status: string;
  criteria: { label: string; met: boolean }[];
}
interface Risk {
  id: string;
  title: string;
  probability: number;
  impact: number;
  status: string;
}
interface Issue {
  id: string;
  title: string;
  status: string;
}
interface Budget {
  id: string;
  plannedAmount: string;
}
interface CostEntry {
  id: string;
  amount: string;
  kind: string;
}
interface HealthRuleSet {
  id: string;
  boardId: string | null;
  rules: { dimension: string; metric: string; operator: string; threshold: number; result: string }[];
}
interface Rollup {
  boardCount: number;
  plannedCost: number;
  actualCost: number;
  overall: string;
}
interface WhatIfResult {
  baseline: { activeProjects: number; totalPlannedCost: number };
  simulated: { activeProjects: number; totalPlannedCost: number };
}

describe('Gestão de portfólio — hierarquia, priorização, stage gates, riscos/issues, orçamento/EVM, RAG (ADR 0053)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ana: string; // workspace_admin: portfolio.manage + board.manage no board PMSP
  let rafael: string; // membro comum, sem portfolio.manage
  let workspaceId: string;
  let boardId: string;
  let portfolioId: string;
  let programId: string;

  const db = adminDb();

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    ana = await api.login(USERS.ana);
    rafael = await api.login(USERS.rafael);
    ({ workspaceId, boardId } = await demoIds(api, ana));
    const portfolios = await api.get<{ data: Portfolio[] }>(`/v1/workspaces/${workspaceId}/portfolios`, { token: ana });
    portfolioId = portfolios.body.data.find((row) => row.name === 'Contratos Públicos')?.id ?? '';
    const programs = await api.get<{ data: Program[] }>(`/v1/workspaces/${workspaceId}/programs`, { token: ana });
    programId = programs.body.data.find((row) => row.name === 'PMSP – Transformação Digital')?.id ?? '';
  });

  afterAll(async () => {
    await db.close();
    await server.close();
  });

  describe('Portfólios e programas', () => {
    it('lista o portfólio e o programa semeados; só `portfolio.manage` cria/exclui', async () => {
      expect(portfolioId).not.toBe('');
      expect(programId).not.toBe('');

      const forbidden = await api.post(`/v1/workspaces/${workspaceId}/portfolios`, {
        token: rafael,
        body: { name: 'Tentativa' },
      });
      expect(forbidden.status).toBe(403);

      const created = await api.post<Portfolio>(`/v1/workspaces/${workspaceId}/portfolios`, {
        token: ana,
        body: { name: 'Portfólio de teste' },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);

      const updated = await api.patch<Portfolio>(`/v1/portfolios/${created.body.id}`, {
        token: ana,
        body: { name: 'Portfólio de teste (renomeado)' },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.name).toBe('Portfólio de teste (renomeado)');

      const removed = await api.delete(`/v1/portfolios/${created.body.id}`, { token: ana });
      expect(removed.status).toBe(200);
    });

    it('cria um programa dentro do portfólio e lê o rollup (sem boards, tudo zerado)', async () => {
      const created = await api.post<Program>(`/v1/workspaces/${workspaceId}/programs`, {
        token: ana,
        body: { name: 'Programa de teste', portfolioId },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body.portfolioId).toBe(portfolioId);

      const rollup = await api.get<Rollup>(`/v1/programs/${created.body.id}/rollup`, { token: ana });
      expect(rollup.status).toBe(200);
      expect(rollup.body.boardCount).toBe(0);
      expect(rollup.body.overall).toBe('grey');

      await api.delete(`/v1/programs/${created.body.id}`, { token: ana });
    });
  });

  describe('Rollup do portfólio/programa semeado (board PMSP já tem orçamento/custo/risco do seed)', () => {
    it('o rollup do programa PMSP agrega o board PMSP', async () => {
      const rollup = await api.get<Rollup>(`/v1/programs/${programId}/rollup`, { token: ana });
      expect(rollup.status, JSON.stringify(rollup.body)).toBe(200);
      expect(rollup.body.boardCount).toBeGreaterThanOrEqual(1);
    });

    it('o rollup do portfólio (via programa) também agrega o board PMSP', async () => {
      const rollup = await api.get<Rollup>(`/v1/portfolios/${portfolioId}/rollup`, { token: ana });
      expect(rollup.status).toBe(200);
      expect(rollup.body.boardCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Priorização: scoring ponderado, WSJF, ranking e matriz valor × esforço', () => {
    it('cria um modelo ponderado, pontua o board PMSP e aparece no ranking', async () => {
      const model = await api.post<ScoringModel>('/v1/scoring-models', {
        token: ana,
        body: {
          name: 'Modelo de teste',
          criteria: [
            { key: 'valor', label: 'Valor', weight: 2, scaleMin: 1, scaleMax: 5, higherIsBetter: true },
            { key: 'esforco', label: 'Esforço', weight: 1, scaleMin: 1, scaleMax: 5, higherIsBetter: false },
          ],
        },
      });
      expect(model.status, JSON.stringify(model.body)).toBe(201);

      const forbidden = await api.post(`/v1/boards/${boardId}/score`, {
        token: rafael,
        body: { scoringModelId: model.body.id, criteriaScores: { valor: 5, esforco: 2 } },
      });
      expect(forbidden.status).toBe(403);

      const score = await api.post<Score>(`/v1/boards/${boardId}/score`, {
        token: ana,
        body: { scoringModelId: model.body.id, criteriaScores: { valor: 5, esforco: 2 } },
      });
      expect(score.status, JSON.stringify(score.body)).toBe(201);
      expect(Number(score.body.totalScore)).toBeGreaterThan(0);

      const ranking = await api.get<{ data: { boardId: string; score: number }[] }>(
        `/v1/scoring-models/${model.body.id}/ranking`,
        { token: ana },
      );
      expect(ranking.status).toBe(200);
      expect(ranking.body.data.some((row) => row.boardId === boardId)).toBe(true);

      const valueEffort = await api.get<{ data: { boardId: string; quadrant: string }[] }>(
        `/v1/scoring-models/${model.body.id}/value-effort`,
        { token: ana },
      );
      expect(valueEffort.status).toBe(200);
      expect(valueEffort.body.data.some((row) => row.boardId === boardId)).toBe(true);
    });

    it('WSJF exige business_value/time_criticality/risk_reduction/job_size; sem eles, 400', async () => {
      const model = await api.post<ScoringModel>('/v1/scoring-models', {
        token: ana,
        body: {
          name: 'WSJF de teste',
          method: 'wsjf',
          criteria: [{ key: 'business_value', label: 'Valor de negócio', weight: 1, scaleMin: 1, scaleMax: 10, higherIsBetter: true }],
        },
      });
      expect(model.status).toBe(201);

      const incomplete = await api.post(`/v1/boards/${boardId}/score`, {
        token: ana,
        body: { scoringModelId: model.body.id, criteriaScores: { business_value: 8 } },
      });
      expect(incomplete.status).toBe(400);

      const complete = await api.post<Score>(`/v1/boards/${boardId}/score`, {
        token: ana,
        body: {
          scoringModelId: model.body.id,
          criteriaScores: { business_value: 8, time_criticality: 5, risk_reduction: 3, job_size: 2 },
        },
      });
      expect(complete.status, JSON.stringify(complete.body)).toBe(201);
      // WSJF = (8+5+3)/2 = 8
      expect(Number(complete.body.totalScore)).toBeCloseTo(8, 3);
    });
  });

  describe('Stage gates', () => {
    let gateId: string;

    it('cria, atualiza o checklist e decide um portão', async () => {
      const created = await api.post<StageGate>(`/v1/boards/${boardId}/stage-gates`, {
        token: ana,
        body: { name: 'Portão de teste', criteria: [{ label: 'Escopo aprovado', met: false }] },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      gateId = created.body.id;

      const updated = await api.patch<StageGate>(`/v1/stage-gates/${gateId}`, {
        token: ana,
        body: { criteria: [{ label: 'Escopo aprovado', met: true }] },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.criteria[0]?.met).toBe(true);

      const decided = await api.post<StageGate>(`/v1/stage-gates/${gateId}/decide`, {
        token: ana,
        body: { status: 'approved' },
      });
      expect(decided.status).toBe(200);
      expect(decided.body.status).toBe('approved');
    });

    afterAll(async () => {
      await api.delete(`/v1/stage-gates/${gateId}`, { token: ana });
    });
  });

  describe('Riscos e problemas', () => {
    it('registra um risco crítico (probabilidade × impacto >= 15) e um problema originado dele', async () => {
      const risk = await api.post<Risk>(`/v1/boards/${boardId}/risks`, {
        token: ana,
        body: { title: 'Risco de teste', probability: 5, impact: 4 },
      });
      expect(risk.status, JSON.stringify(risk.body)).toBe(201);
      expect(risk.body.probability * risk.body.impact).toBeGreaterThanOrEqual(15);

      const issue = await api.post<Issue>(`/v1/boards/${boardId}/issues`, {
        token: ana,
        body: { title: 'Problema de teste', riskId: risk.body.id, severity: 'critical' },
      });
      expect(issue.status, JSON.stringify(issue.body)).toBe(201);

      const resolved = await api.patch<Issue>(`/v1/issues/${issue.body.id}`, { token: ana, body: { status: 'resolved' } });
      expect(resolved.status).toBe(200);
      expect(resolved.body.status).toBe('resolved');

      const closed = await api.patch<Risk>(`/v1/risks/${risk.body.id}`, { token: ana, body: { status: 'closed' } });
      expect(closed.status).toBe(200);
      expect(closed.body.status).toBe('closed');

      await api.delete(`/v1/issues/${issue.body.id}`, { token: ana });
      await api.delete(`/v1/risks/${risk.body.id}`, { token: ana });
    });
  });

  describe('Orçamento e lançamentos de custo', () => {
    it('cria orçamento de projeto e lança custo real', async () => {
      const budget = await api.post<Budget>(`/v1/boards/${boardId}/budgets`, {
        token: ana,
        body: { name: 'Orçamento de teste', plannedAmount: '10000.00' },
      });
      expect(budget.status, JSON.stringify(budget.body)).toBe(201);

      const entry = await api.post<CostEntry>(`/v1/budgets/${budget.body.id}/cost-entries`, {
        token: ana,
        body: { entryDate: '2026-01-15', amount: '2500.00', kind: 'actual' },
      });
      expect(entry.status, JSON.stringify(entry.body)).toBe(201);
      expect(entry.body.kind).toBe('actual');

      const forbidden = await api.post(`/v1/budgets/${budget.body.id}/cost-entries`, {
        token: rafael,
        body: { entryDate: '2026-01-15', amount: '1.00' },
      });
      expect(forbidden.status).toBe(403);

      await api.delete(`/v1/cost-entries/${entry.body.id}`, { token: ana });
      await api.delete(`/v1/budgets/${budget.body.id}`, { token: ana });
    });
  });

  describe('Regras de saúde (RAG automático) e override', () => {
    it('lê as regras padrão do tenant e salva regras próprias do board', async () => {
      const defaults = await api.get<HealthRuleSet>('/v1/health-rules/default', { token: ana });
      expect(defaults.status).toBe(200);
      expect(defaults.body.rules.length).toBeGreaterThan(0);

      const saved = await api.put<HealthRuleSet>(`/v1/boards/${boardId}/health-rules`, {
        token: ana,
        body: {
          rules: [{ dimension: 'cost', metric: 'cpi', operator: 'lt', threshold: 0.85, result: 'red' }],
        },
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.boardId).toBe(boardId);
      expect(saved.body.rules).toHaveLength(1);
    });

    it('sobrepor um relato automático exige `overrideReason`', async () => {
      // Simula um recálculo automático (o worker não roda neste teste) inserindo a linha diretamente.
      await db.db.insert(projectHealth).values({
        tenantId: DEMO_TENANT_ID,
        boardId,
        overall: 'red',
        isAutomatic: true,
      });

      const withoutReason = await api.post(`/v1/boards/${boardId}/project-health`, {
        token: ana,
        body: { overall: 'green' },
      });
      expect(withoutReason.status).toBe(400);

      const withReason = await api.post(`/v1/boards/${boardId}/project-health`, {
        token: ana,
        body: { overall: 'green', overrideReason: 'Risco mitigado manualmente após reunião com o cliente.' },
      });
      expect(withReason.status, JSON.stringify(withReason.body)).toBe(201);
    });
  });

  describe('Status report', () => {
    it('monta o status report do board (saúde, EVM, orçamento, riscos/issues, stage gates)', async () => {
      const report = await api.get<{ boardId: string; evm: { pv: number }; budget: { plannedAmount: number } }>(
        `/v1/boards/${boardId}/status-report`,
        { token: ana },
      );
      expect(report.status, JSON.stringify(report.body)).toBe(200);
      expect(report.body.boardId).toBe(boardId);
    });
  });

  describe('Simulação what-if', () => {
    it('exclui o board PMSP do cenário simulado e o custo planejado cai', async () => {
      const result = await api.post<WhatIfResult>('/v1/portfolio/what-if', {
        token: ana,
        body: { scope: 'program', id: programId, changes: [{ boardId, action: 'exclude' }] },
      });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      expect(result.body.simulated.activeProjects).toBeLessThan(result.body.baseline.activeProjects);
    });
  });
});
