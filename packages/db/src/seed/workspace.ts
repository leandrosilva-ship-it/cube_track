import { createHash } from 'node:crypto';

import { initialPositions, newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';

import {
  accessGrants,
  apiTokens,
  automations,
  budgets,
  columnDefinitions,
  costEntries,
  dashboards,
  favorites,
  folders,
  formFields,
  forms,
  formSubmissions,
  groups,
  invitations,
  issues,
  items,
  memberships,
  notificationPreferences,
  phases,
  phaseTransitionRules,
  pipes,
  portfolios,
  programs,
  projectHealth,
  risks,
  savedFilters,
  scores,
  scoringModels,
  shareLinks,
  slaEvents,
  slas,
  slaTrackers,
  sprints,
  stageGates,
  statusLabels,
  teamMembers,
  teams,
  templates,
  views,
  webhooks,
  widgets,
  workspaces,
  boards,
} from '../schema/index.js';
import { DEMO_TEAMS, DEMO_USERS, FOLDERS } from './data.js';
import { at, addDays } from './random.js';
import {
  DEMO_FORM_TOKEN,
  DEMO_SHARE_TOKEN,
  folderId,
  roleId,
  SEED_REFERENCE_DATE,
  userId,
  type SeedContext,
} from './context.js';
import type { PmspBoard } from './pmsp.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Usuários globais (via app.ensure_user), memberships e times. */
export async function seedPeople(ctx: SeedContext): Promise<void> {
  const { tx, tenantId } = ctx;
  for (const user of DEMO_USERS) {
    const result = await tx.execute<{ id: string }>(
      sql`select app.ensure_user(${user.email}, ${user.name}) as id`,
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error(`Falha ao criar usuário ${user.email}`);
    ctx.users[user.key] = id;
  }
  const owner = userId(ctx, 'ana');
  await tx.insert(memberships).values(
    DEMO_USERS.map((user) => ({
      tenantId,
      userId: userId(ctx, user.key),
      roleId: roleId(ctx, user.role),
      kind: user.role === 'guest' ? ('guest' as const) : ('member' as const),
      status: 'active' as const,
      jobTitle: user.jobTitle,
      joinedAt: at('2025-06-02'),
      createdBy: owner,
    })),
  );
  for (const team of DEMO_TEAMS) {
    const teamId = newId();
    ctx.teamIds[team.name] = teamId;
    await tx.insert(teams).values({ id: teamId, tenantId, name: team.name, createdBy: owner });
    await tx.insert(teamMembers).values(
      team.members.map((key) => ({
        tenantId,
        teamId,
        userId: userId(ctx, key),
        isLead: key === team.lead,
        createdBy: owner,
      })),
    );
  }
  await tx.insert(notificationPreferences).values(
    DEMO_USERS.flatMap((user) => [
      {
        tenantId,
        userId: userId(ctx, user.key),
        channel: 'in_app' as const,
        eventType: '*',
        frequency: 'instant' as const,
        createdBy: owner,
      },
      {
        tenantId,
        userId: userId(ctx, user.key),
        channel: 'email' as const,
        eventType: '*',
        frequency: 'daily' as const,
        createdBy: owner,
      },
      {
        tenantId,
        userId: userId(ctx, user.key),
        channel: 'email' as const,
        eventType: 'mention',
        frequency: 'instant' as const,
        createdBy: owner,
      },
    ]),
  );
  await tx.insert(invitations).values({
    tenantId,
    email: 'lucas.martins@empresademo.com.br',
    roleId: roleId(ctx, 'member'),
    kind: 'member',
    tokenHash: sha256('demo-invitation-token'),
    message: 'Bem-vindo ao time de Sustentação!',
    expiresAt: at(addDays(SEED_REFERENCE_DATE, 7)),
    createdBy: userId(ctx, 'carlos'),
  });
  await tx.insert(apiTokens).values({
    tenantId,
    userId: userId(ctx, 'carlos'),
    name: 'Integração Power BI (somente leitura)',
    tokenPrefix: 'ct_demo',
    tokenHash: sha256('ct_demo_power_bi_token'),
    scopes: ['boards:read', 'items:read'],
    expiresAt: at('2027-06-01'),
    createdBy: userId(ctx, 'carlos'),
  });
}

/** Workspace principal, pastas, portfólio, programa e modelo de scoring. */
export async function seedWorkspace(
  ctx: SeedContext,
): Promise<{ portfolioId: string; programId: string; scoringModelId: string }> {
  const { tx, tenantId } = ctx;
  const owner = userId(ctx, 'ana');
  ctx.workspaceId = newId();
  await tx.insert(workspaces).values({
    id: ctx.workspaceId,
    tenantId,
    name: 'Área de trabalho principal',
    description: 'Contratos, projetos e sustentação da Empresa Demo.',
    icon: 'briefcase',
    color: '#0073ea',
    enabledModules: ['core', 'agile', 'process', 'schedule', 'resources', 'portfolio', 'contracts'],
    position: initialPositions(1)[0] ?? 'a0',
    createdBy: owner,
  });
  const positions = initialPositions(FOLDERS.length);
  for (const [index, name] of FOLDERS.entries()) {
    const id = newId();
    ctx.folderIds[name] = id;
    await tx.insert(folders).values({
      id,
      tenantId,
      workspaceId: ctx.workspaceId,
      name,
      kind: name === 'Templates' ? 'templates' : 'regular',
      position: positions[index] ?? `a${index}`,
      createdBy: owner,
    });
  }

  await tx.insert(accessGrants).values([
    ...DEMO_USERS.filter((user) => user.role !== 'guest').map((user) => ({
      tenantId,
      resourceType: 'workspace' as const,
      resourceId: ctx.workspaceId,
      principalType: 'user' as const,
      principalId: userId(ctx, user.key),
      roleId: roleId(
        ctx,
        user.role === 'owner' || user.role === 'admin' || user.key === 'fernanda'
          ? 'workspace_admin'
          : user.role === 'viewer'
            ? 'workspace_viewer'
            : 'workspace_member',
      ),
      createdBy: owner,
    })),
  ]);

  const scoringModelId = newId();
  await tx.insert(scoringModels).values({
    id: scoringModelId,
    tenantId,
    name: 'Priorização de demandas públicas',
    description: 'Valor ao cidadão, obrigação legal, urgência e risco de execução.',
    criteria: [
      {
        key: 'valor_cidadao',
        label: 'Valor ao cidadão',
        weight: 0.35,
        scaleMin: 1,
        scaleMax: 5,
        higherIsBetter: true,
      },
      {
        key: 'obrigacao_legal',
        label: 'Obrigação legal/normativa',
        weight: 0.25,
        scaleMin: 1,
        scaleMax: 5,
        higherIsBetter: true,
      },
      {
        key: 'urgencia',
        label: 'Urgência',
        weight: 0.2,
        scaleMin: 1,
        scaleMax: 5,
        higherIsBetter: true,
      },
      {
        key: 'risco',
        label: 'Risco de execução',
        weight: 0.2,
        scaleMin: 1,
        scaleMax: 5,
        higherIsBetter: false,
      },
    ],
    isDefault: true,
    createdBy: owner,
  });
  const portfolioId = newId();
  await tx.insert(portfolios).values({
    id: portfolioId,
    tenantId,
    workspaceId: ctx.workspaceId,
    name: 'Contratos Públicos',
    description: 'Portfólio de contratos com órgãos públicos medidos em UST.',
    ownerId: owner,
    scoringModelId,
    position: initialPositions(1)[0] ?? 'a0',
    createdBy: owner,
  });
  const programId = newId();
  await tx.insert(programs).values({
    id: programId,
    tenantId,
    workspaceId: ctx.workspaceId,
    portfolioId,
    name: 'PMSP – Transformação Digital',
    description: 'Programa de transformação digital dos serviços da Prefeitura de São Paulo.',
    ownerId: userId(ctx, 'carlos'),
    startDate: '2025-06-02',
    endDate: '2027-06-01',
    position: initialPositions(1)[0] ?? 'a0',
    createdBy: owner,
  });
  return { portfolioId, programId, scoringModelId };
}

/** Views, formulário, link público, dashboard, automações e governança do board PMSP. */
export async function seedPmspExperience(
  ctx: SeedContext,
  pmsp: PmspBoard,
  refs: { scoringModelId: string; programId: string },
): Promise<void> {
  const { tx, tenantId } = ctx;
  const createdBy = userId(ctx, 'fernanda');
  const boardId = pmsp.boardId;
  const statusId = (label: string) => {
    const id = pmsp.statusLabelIds[label];
    if (id === undefined) throw new Error(`Status desconhecido: ${label}`);
    return id;
  };
  const frenteId = (label: string) => {
    const id = pmsp.frenteLabelIds[label];
    if (id === undefined) throw new Error(`Frente desconhecida: ${label}`);
    return id;
  };

  // Formulário público de solicitação de demanda.
  const formId = newId();
  await tx.insert(forms).values({
    id: formId,
    tenantId,
    boardId,
    targetGroupId: pmsp.groupIds.analise,
    name: 'Solicitação de nova demanda – PMSP',
    description: 'Use este formulário para solicitar uma nova demanda ao contrato 012/2025.',
    isPublic: true,
    publicTokenHash: sha256(DEMO_FORM_TOKEN),
    requiresLogin: false,
    settings: {
      successMessage: 'Solicitação recebida! O PMO entrará em contato em até 2 dias úteis.',
      theme: 'light',
    },
    createdBy,
  });
  const fieldSpecs = [
    { columnKey: null, label: 'Título da demanda', fieldType: 'text', isRequired: true },
    { columnKey: 'c_orgao', label: 'Órgão solicitante', fieldType: 'dropdown', isRequired: true },
    { columnKey: 'c_frente', label: 'Frente de trabalho', fieldType: 'status', isRequired: true },
    { columnKey: 'c_tipo', label: 'Tipo de tarefa', fieldType: 'status', isRequired: false },
    {
      columnKey: null,
      label: 'Descrição e justificativa',
      fieldType: 'long_text',
      isRequired: true,
    },
    { columnKey: null, label: 'E-mail do solicitante', fieldType: 'email', isRequired: true },
  ];
  const fieldPositions = initialPositions(fieldSpecs.length);
  await tx.insert(formFields).values(
    fieldSpecs.map((field, index) => ({
      tenantId,
      formId,
      columnKey: field.columnKey,
      label: field.label,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      position: fieldPositions[index] ?? `a${index}`,
      createdBy,
    })),
  );
  for (const name of [
    'SMPED - Formulário - Solicitação de cadeira de rodas motorizada',
    'OGM - Portal - Página de transparência de recomendações',
  ]) {
    await tx.insert(formSubmissions).values({
      tenantId,
      formId,
      itemId: pmsp.itemIds.get(name) ?? null,
      submitterEmail: 'patricia.gomes@cliente.exemplo.gov.br',
      data: { title: name, description: 'Solicitação enviada pelo formulário público.' },
    });
  }

  // Dashboard Project Health.
  const dashboardId = newId();
  await tx.insert(dashboards).values({
    id: dashboardId,
    tenantId,
    workspaceId: ctx.workspaceId,
    ownerId: createdBy,
    name: 'Project Health – PMSP',
    description: 'Saúde do contrato: prazos, UST por frente e status das demandas.',
    sourceBoardIds: [boardId],
    refreshIntervalSeconds: 300,
    position: initialPositions(1)[0] ?? 'a0',
    createdBy,
  });
  await tx.insert(widgets).values([
    {
      tenantId,
      dashboardId,
      type: 'number',
      title: 'UST em execução',
      config: {
        boardIds: [boardId],
        columnKey: 'c_ust',
        aggregate: 'sum',
        filter: { groupIds: [pmsp.groupIds.andamento] },
      },
      layout: { x: 0, y: 0, w: 3, h: 2 },
      createdBy,
    },
    {
      tenantId,
      dashboardId,
      type: 'number',
      title: 'UST faturadas',
      config: {
        boardIds: [boardId],
        columnKey: 'c_ust',
        aggregate: 'sum',
        filter: { columnKey: 'c_faturamento', operator: 'is_not_empty' },
      },
      layout: { x: 3, y: 0, w: 3, h: 2 },
      createdBy,
    },
    {
      tenantId,
      dashboardId,
      type: 'chart_bar',
      title: 'UST por frente de trabalho',
      config: {
        boardIds: [boardId],
        xColumnKey: 'c_frente',
        yColumnKey: 'c_ust',
        aggregate: 'sum',
      },
      layout: { x: 0, y: 2, w: 6, h: 4 },
      createdBy,
    },
    {
      tenantId,
      dashboardId,
      type: 'chart_pie',
      title: 'Demandas por status',
      config: { boardIds: [boardId], columnKey: 'c_status' },
      layout: { x: 6, y: 0, w: 6, h: 4 },
      createdBy,
    },
    {
      tenantId,
      dashboardId,
      type: 'battery',
      title: 'Prazos (no prazo × replanejadas × atrasadas)',
      config: {
        boardIds: [boardId],
        plannedColumnKey: 'c_termino_planejado',
        replannedColumnKey: 'c_termino_replanejado',
        actualColumnKey: 'c_termino_realizado',
      },
      layout: { x: 6, y: 4, w: 6, h: 2 },
      createdBy,
    },
    {
      tenantId,
      dashboardId,
      type: 'workload',
      title: 'Carga por responsável',
      config: { boardIds: [boardId], peopleColumnKey: 'c_responsaveis' },
      layout: { x: 0, y: 6, w: 12, h: 4 },
      createdBy,
    },
  ]);

  // Views do caso de referência.
  const viewSpecs = [
    { name: 'Quadro principal', type: 'table' as const, isDefault: true, config: {} },
    {
      name: 'Kanban por Frente',
      type: 'kanban' as const,
      config: {
        columnsBy: 'c_frente',
        swimlanesBy: 'group',
        cardFields: ['c_id', 'c_orgao', 'c_responsaveis', 'c_ust', 'c_termino_planejado'],
      },
    },
    {
      name: 'Prazo de Entrega',
      type: 'calendar' as const,
      config: {
        dateColumnKey: 'c_termino_planejado',
        secondaryDateColumnKey: 'c_termino_replanejado',
        colorBy: 'c_status',
      },
    },
    { name: 'Formulários', type: 'form' as const, config: { formId } },
    {
      name: 'Mapeamento',
      type: 'table' as const,
      config: {},
      filters: {
        op: 'and',
        conditions: [
          {
            field: 'c_frente',
            operator: 'any_of',
            value: [frenteId('Mapeamento e Redesenho')],
          },
        ],
      },
    },
    {
      name: 'Cronograma',
      type: 'gantt' as const,
      config: {
        startColumnKey: 'c_inicio',
        endColumnKey: 'c_termino_planejado',
        baselineCompare: true,
        showCriticalPath: true,
        groupBy: 'group',
      },
    },
    { name: 'Project Health', type: 'dashboard' as const, config: { dashboardId } },
    {
      name: 'Atrasadas',
      type: 'table' as const,
      config: {},
      filters: {
        op: 'and',
        conditions: [
          { field: 'c_termino_planejado', operator: 'before', value: 'today' },
          { field: 'c_status', operator: 'none_of', value: [statusId('Concluído')] },
        ],
      },
    },
    {
      name: 'A faturar',
      type: 'table' as const,
      config: {},
      filters: {
        op: 'and',
        conditions: [
          { field: 'c_status', operator: 'any_of', value: [statusId('Concluído')] },
          { field: 'c_faturamento', operator: 'is_empty' },
        ],
      },
    },
  ];
  const viewPositions = initialPositions(viewSpecs.length);
  await tx.insert(views).values(
    viewSpecs.map((view, index) => ({
      tenantId,
      boardId,
      type: view.type,
      name: view.name,
      config: view.config,
      filters: 'filters' in view ? view.filters : null,
      sort:
        view.type === 'table'
          ? [{ columnKey: 'c_termino_planejado', direction: 'asc' as const }]
          : [],
      isDefault: 'isDefault' in view,
      position: viewPositions[index] ?? `a${index}`,
      createdBy,
    })),
  );
  await tx.insert(views).values({
    tenantId,
    boardId,
    ownerId: userId(ctx, 'juliana'),
    type: 'table',
    name: 'Minhas demandas',
    filters: {
      op: 'and',
      conditions: [{ field: 'c_responsaveis', operator: 'any_of', value: ['me'] }],
    },
    position: initialPositions(1)[0] ?? 'a0',
    createdBy: userId(ctx, 'juliana'),
  });
  await tx.insert(savedFilters).values({
    tenantId,
    boardId,
    ownerId: userId(ctx, 'carlos'),
    name: 'Em andamento sem replanejamento',
    filter: {
      op: 'and',
      conditions: [
        { field: 'group_id', operator: 'any_of', value: [pmsp.groupIds.andamento] },
        { field: 'c_termino_replanejado', operator: 'is_empty' },
      ],
    },
    isShared: true,
    createdBy: userId(ctx, 'carlos'),
  });

  // Compartilhamento público somente leitura (como no Monday).
  await tx.insert(shareLinks).values({
    tenantId,
    resourceType: 'board',
    resourceId: boardId,
    tokenHash: sha256(DEMO_SHARE_TOKEN),
    expiresAt: at('2027-06-01'),
    settings: { hiddenColumnKeys: ['c_ust', 'c_faturamento'], allowSearch: true },
    createdBy,
  });
  // Convidado externo: colaborador apenas no board PMSP.
  await tx.insert(accessGrants).values({
    tenantId,
    resourceType: 'board',
    resourceId: boardId,
    principalType: 'user',
    principalId: userId(ctx, 'patricia'),
    roleId: roleId(ctx, 'board_contributor'),
    createdBy,
  });

  await tx.insert(automations).values([
    {
      tenantId,
      workspaceId: ctx.workspaceId,
      boardId,
      name: 'Concluído → mover para Concluídas',
      trigger: {
        type: 'column_value_changed',
        config: { columnKey: 'c_status', to: [statusId('Concluído')] },
      },
      actions: [
        { type: 'move_to_group', config: { groupId: pmsp.groupIds.concluida } },
        {
          type: 'set_column_value',
          config: { binding: 'item.actual_end_date', value: { relative: 'today' } },
        },
      ],
      ownerId: createdBy,
      runCount: 20,
      createdBy,
    },
    {
      tenantId,
      workspaceId: ctx.workspaceId,
      boardId,
      name: 'Prazo em 3 dias úteis → notificar responsáveis',
      trigger: {
        type: 'date_arrives',
        config: { columnKey: 'c_termino_planejado', offsetBusinessDays: -3 },
      },
      conditions: {
        op: 'and',
        conditions: [{ field: 'c_status', operator: 'none_of', value: [statusId('Concluído')] }],
      },
      actions: [
        {
          type: 'notify',
          config: {
            peopleColumnKey: 'c_responsaveis',
            message: 'O prazo de "{item.name}" vence em 3 dias úteis.',
          },
        },
      ],
      ownerId: createdBy,
      runCount: 41,
      createdBy,
    },
    {
      tenantId,
      workspaceId: ctx.workspaceId,
      boardId,
      name: 'OS emitida → mover para Em Andamento',
      trigger: {
        type: 'column_value_changed',
        config: { columnKey: 'c_os_emitida', toLabel: 'Sim' },
      },
      actions: [{ type: 'move_to_group', config: { groupId: pmsp.groupIds.andamento } }],
      ownerId: createdBy,
      isEnabled: false,
      createdBy,
    },
  ]);
  await tx.insert(webhooks).values({
    tenantId,
    workspaceId: ctx.workspaceId,
    boardId,
    name: 'Notificar ERP financeiro sobre faturamento',
    url: 'https://hooks.exemplo.com.br/cubetrack/faturamento',
    secretCiphertext: 'enc:v1:demo-not-a-real-secret',
    events: ['item.values.updated'],
    isEnabled: false,
    createdBy: userId(ctx, 'carlos'),
  });

  // Governança de portfólio.
  const healthRows: (typeof projectHealth.$inferInsert)[] = [
    {
      tenantId,
      boardId,
      reportedBy: createdBy,
      reportedAt: at('2026-08-03'),
      overall: 'yellow',
      schedule: 'yellow',
      cost: 'green',
      scope: 'green',
      quality: 'green',
      risk: 'yellow',
      percentComplete: '48.00',
      spi: '0.920',
      cpi: '1.040',
      summary: 'Atrasos pontuais por dependência de dados dos órgãos.',
    },
    {
      tenantId,
      boardId,
      reportedBy: createdBy,
      reportedAt: at('2026-09-01'),
      overall: 'yellow',
      schedule: 'yellow',
      cost: 'green',
      scope: 'green',
      quality: 'green',
      risk: 'green',
      percentComplete: '56.00',
      spi: '0.950',
      cpi: '1.030',
      summary: 'Replanejamentos aprovados; risco de integração SEI mitigado.',
    },
    {
      tenantId,
      boardId,
      reportedBy: createdBy,
      reportedAt: at('2026-10-01'),
      overall: 'green',
      schedule: 'green',
      cost: 'green',
      scope: 'green',
      quality: 'green',
      risk: 'yellow',
      percentComplete: '63.00',
      spi: '1.010',
      cpi: '1.020',
      summary: 'Execução dentro do plano. Atenção à capacidade de UX em novembro.',
    },
  ];
  await tx.insert(projectHealth).values(healthRows.map((row) => ({ ...row, createdBy })));
  await tx.insert(scores).values({
    tenantId,
    scoringModelId: refs.scoringModelId,
    boardId,
    criteriaScores: { valor_cidadao: 5, obrigacao_legal: 4, urgencia: 4, risco: 3 },
    totalScore: '4.0000',
    scoredBy: userId(ctx, 'carlos'),
    rationale: 'Contrato estratégico com alto impacto em serviços ao cidadão.',
    createdBy,
  });
  const gatePositions = initialPositions(3);
  await tx.insert(stageGates).values([
    {
      tenantId,
      boardId,
      name: 'Iniciação',
      position: gatePositions[0] ?? 'a0',
      status: 'approved',
      dueDate: '2025-06-15',
      decidedBy: userId(ctx, 'ana'),
      decidedAt: at('2025-06-13'),
      criteria: [{ label: 'Termo de abertura assinado', met: true }],
      createdBy,
    },
    {
      tenantId,
      boardId,
      name: 'Planejamento',
      position: gatePositions[1] ?? 'a1',
      status: 'approved',
      dueDate: '2025-07-15',
      decidedBy: userId(ctx, 'ana'),
      decidedAt: at('2025-07-11'),
      criteria: [
        { label: 'Plano de trabalho aprovado pelo fiscal', met: true },
        { label: 'Catálogo de serviços validado', met: true },
      ],
      createdBy,
    },
    {
      tenantId,
      boardId,
      name: 'Renovação contratual',
      position: gatePositions[2] ?? 'a2',
      status: 'pending',
      dueDate: '2027-03-01',
      criteria: [{ label: 'Relatório de desempenho anual', met: false }],
      createdBy,
    },
  ]);
  const riskId = newId();
  await tx.insert(risks).values([
    {
      id: riskId,
      tenantId,
      boardId,
      itemId: pmsp.itemIds.get('SMIT - SEI – Redesenho Integração SEI') ?? null,
      title: 'Instabilidade da API do SEI em homologação',
      category: 'Técnico',
      probability: 3,
      impact: 4,
      status: 'mitigating',
      strategy: 'mitigate',
      mitigationPlan: 'Mock da API e janela semanal de testes com a PRODAM.',
      ownerId: userId(ctx, 'juliana'),
      dueDate: '2026-11-15',
      createdBy,
    },
    {
      tenantId,
      boardId,
      title: 'Saldo de UST insuficiente para o 2º semestre',
      category: 'Contratual',
      probability: 2,
      impact: 5,
      status: 'open',
      strategy: 'mitigate',
      mitigationPlan: 'Acompanhar consumo mensal e preparar aditivo de 25%.',
      ownerId: userId(ctx, 'carlos'),
      dueDate: '2026-12-01',
      createdBy,
    },
  ]);
  await tx.insert(issues).values({
    tenantId,
    boardId,
    riskId,
    title: 'Ambiente de homologação do SEI indisponível por 3 dias',
    severity: 'high',
    status: 'resolved',
    ownerId: userId(ctx, 'juliana'),
    resolvedAt: at('2026-09-18'),
    resolution: 'Restabelecido pela PRODAM; prazo replanejado em 5 dias.',
    createdBy,
  });
  const budgetId = newId();
  await tx.insert(budgets).values({
    id: budgetId,
    tenantId,
    boardId,
    name: 'Orçamento de execução – contrato 012/2025',
    category: 'opex',
    plannedAmount: '1150000.0000',
    fiscalYear: 2026,
    periodStart: '2025-06-02',
    periodEnd: '2027-06-01',
    createdBy: userId(ctx, 'carlos'),
  });
  await tx.insert(costEntries).values(
    ['2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'].map((entryDate, index) => ({
      tenantId,
      budgetId,
      boardId,
      entryDate,
      amount: (61000 + index * 2500).toFixed(4),
      kind: 'actual' as const,
      source: 'timesheet' as const,
      category: 'Equipe técnica',
      description: `Custo de equipe apurado via timesheet – ${entryDate.slice(0, 7)}`,
      createdBy: userId(ctx, 'thiago'),
    })),
  );

  await tx.insert(favorites).values([
    {
      tenantId,
      userId: userId(ctx, 'ana'),
      entityType: 'board',
      entityId: boardId,
      position: 'a0',
      createdBy,
    },
    {
      tenantId,
      userId: userId(ctx, 'ana'),
      entityType: 'dashboard',
      entityId: dashboardId,
      position: 'a1',
      createdBy,
    },
    {
      tenantId,
      userId: userId(ctx, 'carlos'),
      entityType: 'program',
      entityId: refs.programId,
      position: 'a0',
      createdBy,
    },
    {
      tenantId,
      userId: userId(ctx, 'fernanda'),
      entityType: 'board',
      entityId: boardId,
      position: 'a0',
      createdBy,
    },
  ]);
}

/** Board ágil (backlog + sprint), board de processo (pipe/SLA) e template. */
export async function seedOtherBoards(
  ctx: SeedContext,
): Promise<{ backlogBoardId: string; processBoardId: string }> {
  const { tx, tenantId } = ctx;
  const createdBy = userId(ctx, 'carlos');
  const internalFolder = folderId(ctx, 'Demandas internas');
  const boardPositions = initialPositions(2);

  // Backlog ágil com sprint ativa.
  const backlogBoardId = newId();
  await tx.insert(boards).values({
    id: backlogBoardId,
    tenantId,
    workspaceId: ctx.workspaceId,
    folderId: internalFolder,
    kind: 'backlog',
    name: 'Melhorias internas',
    description: 'Backlog de melhorias de ferramentas e processos internos.',
    ownerId: createdBy,
    position: boardPositions[0] ?? 'a0',
    createdBy,
  });
  const backlogGroups = { backlog: newId(), sprint: newId() };
  const backlogGroupPositions = initialPositions(2);
  await tx.insert(groups).values([
    {
      id: backlogGroups.sprint,
      tenantId,
      boardId: backlogBoardId,
      name: 'Sprint 14',
      color: '#00c875',
      position: backlogGroupPositions[0] ?? 'a0',
      createdBy,
    },
    {
      id: backlogGroups.backlog,
      tenantId,
      boardId: backlogBoardId,
      name: 'Backlog',
      color: '#c4c4c4',
      position: backlogGroupPositions[1] ?? 'a1',
      createdBy,
    },
  ]);
  const backlogColumns = { status: newId(), points: newId(), owner: newId() };
  const backlogColumnPositions = initialPositions(3);
  await tx.insert(columnDefinitions).values([
    {
      id: backlogColumns.status,
      tenantId,
      boardId: backlogBoardId,
      key: 'c_status',
      type: 'status',
      title: 'Status',
      position: backlogColumnPositions[0] ?? 'a0',
      createdBy,
    },
    {
      id: backlogColumns.points,
      tenantId,
      boardId: backlogBoardId,
      key: 'c_pontos',
      type: 'number',
      title: 'Story points',
      settings: { aggregate: 'sum' },
      position: backlogColumnPositions[1] ?? 'a1',
      createdBy,
    },
    {
      id: backlogColumns.owner,
      tenantId,
      boardId: backlogBoardId,
      key: 'c_responsavel',
      type: 'people',
      title: 'Responsável',
      position: backlogColumnPositions[2] ?? 'a2',
      createdBy,
    },
  ]);
  const agileLabels = { todo: newId(), doing: newId(), done: newId() };
  const agileLabelPositions = initialPositions(3);
  await tx.insert(statusLabels).values([
    {
      id: agileLabels.todo,
      tenantId,
      columnId: backlogColumns.status,
      label: 'A fazer',
      color: '#c4c4c4',
      category: 'not_started',
      position: agileLabelPositions[0] ?? 'a0',
      isDefault: true,
      createdBy,
    },
    {
      id: agileLabels.doing,
      tenantId,
      columnId: backlogColumns.status,
      label: 'Fazendo',
      color: '#fdab3d',
      category: 'in_progress',
      position: agileLabelPositions[1] ?? 'a1',
      createdBy,
    },
    {
      id: agileLabels.done,
      tenantId,
      columnId: backlogColumns.status,
      label: 'Feito',
      color: '#00c875',
      category: 'done',
      position: agileLabelPositions[2] ?? 'a2',
      createdBy,
    },
  ]);
  const sprintId = newId();
  await tx.insert(sprints).values({
    id: sprintId,
    tenantId,
    boardId: backlogBoardId,
    name: 'Sprint 14',
    goal: 'Automatizar o relatório mensal de medição de UST.',
    startDate: '2026-10-06',
    endDate: '2026-10-17',
    state: 'active',
    capacityPoints: '24.00',
    position: 'a0',
    createdBy,
  });
  const backlogItems = [
    {
      name: 'Relatório automático de medição mensal',
      points: '8',
      label: agileLabels.doing,
      owner: 'bruno',
      sprint: true,
    },
    {
      name: 'Template de plano de trabalho por OS',
      points: '5',
      label: agileLabels.done,
      owner: 'fernanda',
      sprint: true,
    },
    {
      name: 'Checklist de homologação padronizado',
      points: '3',
      label: agileLabels.todo,
      owner: 'rafael',
      sprint: true,
    },
    {
      name: 'Integração do timesheet com a folha',
      points: '13',
      label: agileLabels.todo,
      owner: 'juliana',
      sprint: false,
    },
    {
      name: 'Guia de estilo para portais municipais',
      points: '5',
      label: agileLabels.todo,
      owner: 'mariana',
      sprint: false,
    },
    {
      name: 'Painel de capacidade da equipe',
      points: '8',
      label: agileLabels.todo,
      owner: 'bruno',
      sprint: false,
    },
  ];
  const backlogPositions = initialPositions(backlogItems.length);
  await tx.insert(items).values(
    backlogItems.map((item, index) => ({
      tenantId,
      boardId: backlogBoardId,
      groupId: item.sprint ? backlogGroups.sprint : backlogGroups.backlog,
      name: item.name,
      position: backlogPositions[index] ?? `a${index}`,
      sprintId: item.sprint ? sprintId : null,
      values: {
        c_status: { labelId: item.label },
        c_pontos: { n: item.points },
        c_responsavel: { personIds: [userId(ctx, item.owner)], teamIds: [] },
      },
      createdBy,
    })),
  );

  // Processo (pipe) de triagem com fases e SLA.
  const processBoardId = newId();
  await tx.insert(boards).values({
    id: processBoardId,
    tenantId,
    workspaceId: ctx.workspaceId,
    folderId: internalFolder,
    kind: 'process',
    name: 'Triagem de solicitações',
    description: 'Recebimento e triagem de solicitações antes da emissão de OS.',
    ownerId: userId(ctx, 'fernanda'),
    workCalendarId: ctx.calendarId,
    position: boardPositions[1] ?? 'a1',
    createdBy,
  });
  const phaseNames = ['Recebida', 'Em triagem', 'Encaminhada'] as const;
  const phaseGroupIds = phaseNames.map(() => newId());
  const phasePositions = initialPositions(phaseNames.length);
  await tx.insert(groups).values(
    phaseNames.map((name, index) => ({
      id: phaseGroupIds[index] ?? newId(),
      tenantId,
      boardId: processBoardId,
      name,
      position: phasePositions[index] ?? `a${index}`,
      createdBy,
    })),
  );
  await tx.insert(columnDefinitions).values([
    {
      tenantId,
      boardId: processBoardId,
      key: 'c_solicitante',
      type: 'email',
      title: 'E-mail do solicitante',
      position: 'a0',
      isRequired: true,
      createdBy,
    },
    {
      tenantId,
      boardId: processBoardId,
      key: 'c_estimativa',
      type: 'number',
      title: 'Estimativa (UST)',
      settings: { unit: 'UST', unitPosition: 'suffix' },
      position: 'a1',
      createdBy,
    },
  ]);
  const pipeId = newId();
  await tx
    .insert(pipes)
    .values({ id: pipeId, tenantId, boardId: processBoardId, name: 'Triagem', createdBy });
  const phaseIds = phaseNames.map(() => newId());
  await tx.insert(phases).values(
    phaseNames.map((name, index) => ({
      id: phaseIds[index] ?? newId(),
      tenantId,
      pipeId,
      groupId: phaseGroupIds[index] ?? newId(),
      name,
      kind:
        index === 0
          ? ('start' as const)
          : index === phaseNames.length - 1
            ? ('done' as const)
            : ('intermediate' as const),
      requiredColumnKeys: index === 1 ? ['c_estimativa'] : [],
      wipLimit: index === 1 ? 5 : null,
      position: phasePositions[index] ?? `a${index}`,
      createdBy,
    })),
  );
  const [recebida, triagem, encaminhada] = phaseIds as [string, string, string];
  await tx.insert(phaseTransitionRules).values([
    { tenantId, pipeId, fromPhaseId: recebida, toPhaseId: triagem, createdBy },
    {
      tenantId,
      pipeId,
      fromPhaseId: triagem,
      toPhaseId: encaminhada,
      requiredColumnKeys: ['c_estimativa'],
      allowedRoleIds: [roleId(ctx, 'board_owner'), roleId(ctx, 'board_editor')],
      createdBy,
    },
  ]);
  const slaId = newId();
  await tx.insert(slas).values({
    id: slaId,
    tenantId,
    boardId: processBoardId,
    pipeId,
    phaseId: triagem,
    name: 'Triagem em até 8 horas úteis',
    targetMinutes: 480,
    warningPercent: 75,
    useBusinessTime: true,
    workCalendarId: ctx.calendarId,
    createdBy,
  });
  const processItems = [
    {
      name: 'Solicitação: relatório de acessos ao portal OGM',
      phase: 0,
      email: 'ogm@cliente.exemplo.gov.br',
    },
    {
      name: 'Solicitação: novo campo no formulário SMPED',
      phase: 1,
      email: 'smped@cliente.exemplo.gov.br',
      breached: false,
    },
    {
      name: 'Solicitação: ajuste de permissão no SIGRC COHAB',
      phase: 1,
      email: 'cohab@cliente.exemplo.gov.br',
      breached: true,
    },
    {
      name: 'Solicitação: atualização de base API Creator',
      phase: 2,
      email: 'ouvidoria@cliente.exemplo.gov.br',
    },
  ];
  const processPositions = initialPositions(processItems.length);
  for (const [index, entry] of processItems.entries()) {
    const itemId = newId();
    const enteredAt = at(addDays(SEED_REFERENCE_DATE, -(index + 1)), '09:00');
    await tx.insert(items).values({
      id: itemId,
      tenantId,
      boardId: processBoardId,
      groupId: phaseGroupIds[entry.phase] ?? newId(),
      name: entry.name,
      position: processPositions[index] ?? `a${index}`,
      phaseId: phaseIds[entry.phase] ?? null,
      phaseEnteredAt: enteredAt,
      values: {
        c_solicitante: { email: entry.email },
        ...(entry.phase > 0 ? { c_estimativa: { n: '16' } } : {}),
      },
      createdBy,
    });
    if (entry.phase === 1) {
      const trackerId = newId();
      const breached = entry.breached === true;
      await tx.insert(slaTrackers).values({
        id: trackerId,
        tenantId,
        slaId,
        itemId,
        status: breached ? 'breached' : 'running',
        startedAt: enteredAt,
        dueAt: new Date(enteredAt.getTime() + 8 * 3_600_000),
        warningAt: new Date(enteredAt.getTime() + 6 * 3_600_000),
        createdBy,
      });
      await tx.insert(slaEvents).values([
        {
          tenantId,
          slaId,
          trackerId,
          itemId,
          type: 'started',
          occurredAt: enteredAt,
          elapsedMinutes: 0,
          createdBy,
        },
        ...(breached
          ? [
              {
                tenantId,
                slaId,
                trackerId,
                itemId,
                type: 'warning' as const,
                occurredAt: new Date(enteredAt.getTime() + 6 * 3_600_000),
                elapsedMinutes: 360,
                createdBy,
              },
              {
                tenantId,
                slaId,
                trackerId,
                itemId,
                type: 'breached' as const,
                occurredAt: new Date(enteredAt.getTime() + 8 * 3_600_000),
                elapsedMinutes: 480,
                createdBy,
              },
            ]
          : []),
      ]);
    }
  }

  // Template de board (pasta Templates) + registro no catálogo de templates.
  const templateBoardId = newId();
  await tx.insert(boards).values({
    id: templateBoardId,
    tenantId,
    workspaceId: ctx.workspaceId,
    folderId: folderId(ctx, 'Templates'),
    kind: 'project',
    name: 'Template – Contrato UST',
    description: 'Estrutura padrão para novos contratos medidos em UST.',
    isTemplate: true,
    position: 'a0',
    createdBy,
  });
  const templateGroupPositions = initialPositions(3);
  await tx.insert(groups).values(
    ['Demandas em Análise', 'Demandas em Andamento', 'Concluídas'].map((name, index) => ({
      tenantId,
      boardId: templateBoardId,
      name,
      position: templateGroupPositions[index] ?? `a${index}`,
      createdBy,
    })),
  );
  await tx.insert(templates).values({
    tenantId,
    workspaceId: ctx.workspaceId,
    kind: 'board',
    name: 'Contrato UST (órgão público)',
    description:
      'Board com grupos por status macro, colunas de OS/SEI/UST, views Kanban por frente e Cronograma.',
    category: 'Setor público',
    payload: {
      sourceBoardId: templateBoardId,
      includeItems: false,
      modules: ['contracts', 'schedule'],
    },
    createdBy,
  });

  return { backlogBoardId, processBoardId };
}
