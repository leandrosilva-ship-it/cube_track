import {
  boardTemplates,
  defaultStatusLabels,
  parseTemplatePayload,
  type BoardTemplatePayload,
  type BoardTemplate,
  type WorkspaceTemplatePayload,
} from '@cube-track/shared';
import { isNull } from 'drizzle-orm';

import type { Database } from '../client.js';
import { templates } from '../schema/index.js';

export interface SeedTemplatesResult {
  created: boolean;
  count: number;
}

/** Despe o `key` (só usado pelo catálogo embutido, nunca lido por `BoardBlueprintWriter.fromTemplate`)
 * e revalida como `BoardTemplatePayload` — garante que o que semeamos é exatamente o que a API aceitaria
 * de um `POST /v1/templates` de verdade. */
function toPayload(template: BoardTemplate): BoardTemplatePayload {
  const { key: _key, kind: _kind, ...rest } = template;
  return parseTemplatePayload('board', rest);
}

const STATUS = defaultStatusLabels('pt-BR');

function priorityOptions() {
  return [
    { label: 'Alta', color: '#df2f4a' },
    { label: 'Média', color: '#fdab3d' },
    { label: 'Baixa', color: '#579bfc' },
  ];
}

// ------------------------------------------------------------------ 1. Implantação – Template Base ---

const implantacaoBase: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Implantação – Template Base',
  description:
    'Fases padrão de um projeto de implantação: descoberta, planejamento, execução, homologação e encerramento.',
  icon: 'rocket',
  groups: [
    { name: 'Descoberta', color: '#a25ddc' },
    { name: 'Planejamento', color: '#579bfc' },
    { name: 'Execução', color: '#fdab3d' },
    { name: 'Homologação', color: '#66ccff' },
    { name: 'Encerramento', color: '#00c875' },
  ],
  columns: [
    { key: 'c_status', type: 'status', title: 'Status', width: 140, labels: STATUS },
    { key: 'c_owner', type: 'people', title: 'Responsável', width: 150 },
    { key: 'c_timeline', type: 'timeline', title: 'Cronograma', width: 180 },
    {
      key: 'c_priority',
      type: 'dropdown',
      title: 'Prioridade',
      width: 120,
      settings: { multiple: false },
      options: priorityOptions(),
    },
    {
      key: 'c_entregavel',
      type: 'long_text',
      title: 'Entregável',
      width: 260,
      description: 'O que precisa ser produzido/validado nesta etapa.',
    },
    {
      key: 'c_horas_estimadas',
      type: 'number',
      title: 'Horas estimadas',
      width: 130,
      settings: { unit: 'h', unitPosition: 'suffix', decimals: 1, aggregate: 'sum' },
    },
    {
      key: 'c_progress',
      type: 'progress',
      title: 'Progresso',
      width: 140,
      settings: { mode: 'status_columns', sourceColumnKeys: ['c_status'] },
    },
    { key: 'c_data_entrega', type: 'date', title: 'Data de entrega', width: 130 },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Tabela principal',
});

// --------------------------------------------------------------------------------- 2. Sustentação ---

const sustentacao: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Sustentação',
  description: 'Fila de atendimento contínuo pós-implantação: chamados, dúvidas e pequenas manutenções.',
  icon: 'life-buoy',
  groups: [
    { name: 'Fila', color: '#c4c4c4' },
    { name: 'Em atendimento', color: '#fdab3d' },
    { name: 'Aguardando cliente', color: '#a25ddc' },
    { name: 'Resolvido', color: '#00c875' },
  ],
  columns: [
    {
      key: 'c_status',
      type: 'status',
      title: 'Status',
      width: 140,
      labels: [
        { label: 'Aberto', color: '#c4c4c4', category: 'not_started' },
        { label: 'Em atendimento', color: '#fdab3d', category: 'in_progress' },
        { label: 'Aguardando cliente', color: '#a25ddc', category: 'stuck' },
        { label: 'Resolvido', color: '#00c875', category: 'done' },
      ],
    },
    { key: 'c_solicitante', type: 'text', title: 'Solicitante', width: 160, isRequired: true },
    {
      key: 'c_categoria',
      type: 'dropdown',
      title: 'Categoria',
      width: 140,
      settings: { multiple: false },
      options: [
        { label: 'Incidente', color: '#df2f4a' },
        { label: 'Solicitação', color: '#579bfc' },
        { label: 'Dúvida', color: '#66ccff' },
        { label: 'Melhoria', color: '#00c875' },
      ],
    },
    {
      key: 'c_prioridade',
      type: 'dropdown',
      title: 'Prioridade',
      width: 120,
      settings: { multiple: false },
      options: [
        { label: 'Crítica', color: '#bb3354' },
        { label: 'Alta', color: '#df2f4a' },
        { label: 'Média', color: '#fdab3d' },
        { label: 'Baixa', color: '#579bfc' },
      ],
    },
    { key: 'c_responsavel', type: 'people', title: 'Responsável', width: 150 },
    { key: 'c_sla_limite', type: 'date', title: 'Limite do SLA', width: 130 },
    { key: 'c_resolucao', type: 'long_text', title: 'Resolução', width: 280 },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Fila de atendimento',
});

// -------------------------------------------------------------------------------------- 3. Scrum ---

const scrum: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Scrum',
  description: 'Backlog priorizado, sprint atual, revisão e concluído — com story points e sprint.',
  icon: 'list-checks',
  groups: [
    { name: 'Backlog', color: '#c4c4c4' },
    { name: 'Sprint atual', color: '#579bfc' },
    { name: 'Em revisão', color: '#a25ddc' },
    { name: 'Concluído', color: '#00c875' },
  ],
  columns: [
    { key: 'c_status', type: 'status', title: 'Status', width: 140, labels: STATUS },
    {
      key: 'c_tipo',
      type: 'dropdown',
      title: 'Tipo',
      width: 120,
      settings: { multiple: false },
      options: [
        { label: 'Épico', color: '#a25ddc' },
        { label: 'História', color: '#579bfc' },
        { label: 'Tarefa', color: '#66ccff' },
        { label: 'Bug', color: '#df2f4a' },
      ],
    },
    {
      key: 'c_story_points',
      type: 'number',
      title: 'Story points',
      width: 110,
      settings: { decimals: 0, aggregate: 'sum' },
    },
    {
      key: 'c_sprint',
      type: 'dropdown',
      title: 'Sprint',
      width: 130,
      settings: { multiple: false },
      options: [
        { label: 'Sprint 1', color: '#579bfc' },
        { label: 'Sprint 2', color: '#66ccff' },
        { label: 'Sprint 3', color: '#a25ddc' },
      ],
    },
    { key: 'c_owner', type: 'people', title: 'Responsável', width: 150 },
    { key: 'c_priority', type: 'dropdown', title: 'Prioridade', width: 120, settings: { multiple: false }, options: priorityOptions() },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Sprint board',
});

// --------------------------------------------------------------------- 4. Kanban de serviços ---

const kanbanServicos: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Kanban de serviços',
  description: 'Fluxo simples de solicitação de serviço: solicitado, em análise, em execução, concluído.',
  icon: 'kanban',
  groups: [
    { name: 'Solicitado', color: '#c4c4c4' },
    { name: 'Em análise', color: '#66ccff' },
    { name: 'Em execução', color: '#fdab3d' },
    { name: 'Concluído', color: '#00c875' },
  ],
  columns: [
    { key: 'c_status', type: 'status', title: 'Status', width: 140, labels: STATUS },
    { key: 'c_solicitante', type: 'text', title: 'Solicitante', width: 160 },
    {
      key: 'c_tipo_servico',
      type: 'dropdown',
      title: 'Tipo de serviço',
      width: 160,
      settings: { multiple: false },
      options: [
        { label: 'Infraestrutura', color: '#579bfc' },
        { label: 'Acesso', color: '#66ccff' },
        { label: 'Desenvolvimento', color: '#a25ddc' },
        { label: 'Outro', color: '#c4c4c4' },
      ],
    },
    { key: 'c_responsavel', type: 'people', title: 'Responsável', width: 150 },
    { key: 'c_prazo', type: 'date', title: 'Prazo', width: 130 },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Kanban',
});

// ------------------------------------------------------------------------------- 6. Onboarding ---

const onboarding: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Onboarding',
  description: 'Checklist de integração de uma nova pessoa: pré-chegada, primeira semana e primeiro mês.',
  icon: 'user-plus',
  groups: [
    { name: 'Pré-chegada', color: '#a25ddc' },
    { name: 'Primeira semana', color: '#579bfc' },
    { name: 'Primeiro mês', color: '#fdab3d' },
    { name: 'Concluído', color: '#00c875' },
  ],
  columns: [
    { key: 'c_status', type: 'status', title: 'Status', width: 140, labels: STATUS },
    { key: 'c_novo_colaborador', type: 'text', title: 'Novo(a) colaborador(a)', width: 180, isRequired: true },
    { key: 'c_responsavel_rh', type: 'people', title: 'Responsável RH', width: 150 },
    { key: 'c_gestor', type: 'people', title: 'Gestor(a)', width: 150 },
    { key: 'c_data_admissao', type: 'date', title: 'Data de admissão', width: 140 },
    { key: 'c_concluido', type: 'checkbox', title: 'Concluído', width: 100 },
    { key: 'c_observacoes', type: 'long_text', title: 'Observações', width: 260 },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Checklist',
});

// -------------------------------------------------------------------- 7. Gestão de contratos UST ---

const contratosUst: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Gestão de contratos UST',
  description:
    'Ordens de serviço medidas em UST (caso de referência de consultorias que atendem órgãos públicos): ' +
    'processo SEI, UST consumida, valor da UST e valor calculado da OS.',
  icon: 'file-text',
  groups: [
    { name: 'Em análise', color: '#579bfc' },
    { name: 'Em andamento', color: '#fdab3d' },
    { name: 'Concluídas', color: '#00c875' },
  ],
  columns: [
    {
      key: 'c_id',
      type: 'auto_id',
      title: 'Nº da OS',
      width: 120,
      settings: { mask: 'OS-{YYYY}-{SEQ:4}', resetPeriod: 'yearly', applyToSubitems: false },
    },
    { key: 'c_status', type: 'status', title: 'Status', width: 140, labels: STATUS },
    {
      key: 'c_os_emitida',
      type: 'status',
      title: 'OS emitida',
      width: 120,
      labels: [
        { label: 'Sim', color: '#00c875', category: 'done' },
        { label: 'Não', color: '#c4c4c4', category: 'not_started' },
      ],
    },
    {
      key: 'c_sei',
      type: 'text',
      title: 'Processo SEI',
      width: 170,
      description: 'Obrigatório quando a OS é emitida.',
      requiredWhenLabel: { columnKey: 'c_os_emitida', labelIndex: 0 },
    },
    {
      key: 'c_ust',
      type: 'number',
      title: 'UST',
      width: 110,
      settings: { unit: 'UST', unitPosition: 'suffix', decimals: 2, aggregate: 'sum' },
    },
    {
      key: 'c_valor_ust',
      type: 'number',
      title: 'Valor da UST',
      width: 120,
      settings: { unit: 'R$', unitPosition: 'prefix', decimals: 2 },
    },
    {
      key: 'c_valor_os',
      type: 'formula',
      title: 'Valor da OS',
      width: 140,
      settings: { expression: 'ROUND({c_ust} * {c_valor_ust}, 2)', unit: 'R$', unitPosition: 'prefix', decimals: 2 },
    },
    { key: 'c_owner', type: 'people', title: 'Responsáveis', width: 150 },
    { key: 'c_due', type: 'date', title: 'Término planejado', width: 130 },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Tabela principal',
});

// -------------------------------------------------------------------------------------- 5. PMO ---

const pmoPortfolioBoard: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Portfólio de projetos',
  description: 'Visão de portfólio: status, prioridade, orçamento, progresso e risco de cada projeto.',
  icon: 'briefcase',
  groups: [
    { name: 'Proposto', color: '#c4c4c4' },
    { name: 'Em andamento', color: '#579bfc' },
    { name: 'Concluído', color: '#00c875' },
  ],
  columns: [
    { key: 'c_status', type: 'status', title: 'Status', width: 140, labels: STATUS },
    { key: 'c_owner', type: 'people', title: 'Patrocinador/Responsável', width: 170 },
    { key: 'c_timeline', type: 'timeline', title: 'Cronograma', width: 180 },
    { key: 'c_priority', type: 'dropdown', title: 'Prioridade', width: 120, settings: { multiple: false }, options: priorityOptions() },
    {
      key: 'c_risco',
      type: 'dropdown',
      title: 'Risco',
      width: 120,
      settings: { multiple: false },
      options: [
        { label: 'Alto', color: '#df2f4a' },
        { label: 'Médio', color: '#fdab3d' },
        { label: 'Baixo', color: '#00c875' },
      ],
    },
    {
      key: 'c_orcamento',
      type: 'number',
      title: 'Orçamento',
      width: 140,
      settings: { unit: 'R$', unitPosition: 'prefix', decimals: 2 },
    },
    {
      key: 'c_progress',
      type: 'progress',
      title: 'Progresso',
      width: 140,
      settings: { mode: 'status_columns', sourceColumnKeys: ['c_status'] },
    },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Portfólio',
});

const pmoRisksBoard: BoardTemplatePayload = parseTemplatePayload('board', {
  name: 'Riscos e problemas',
  description: 'Registro de riscos e problemas do portfólio, com dono, probabilidade/impacto e plano de ação.',
  icon: 'alert-triangle',
  groups: [
    { name: 'Riscos', color: '#fdab3d' },
    { name: 'Problemas', color: '#df2f4a' },
    { name: 'Encerrados', color: '#00c875' },
  ],
  columns: [
    { key: 'c_status', type: 'status', title: 'Status', width: 140, labels: STATUS },
    {
      key: 'c_tipo',
      type: 'dropdown',
      title: 'Tipo',
      width: 120,
      settings: { multiple: false },
      options: [
        { label: 'Risco', color: '#fdab3d' },
        { label: 'Problema', color: '#df2f4a' },
      ],
    },
    { key: 'c_owner', type: 'people', title: 'Dono', width: 150 },
    {
      key: 'c_severidade',
      type: 'dropdown',
      title: 'Severidade',
      width: 120,
      settings: { multiple: false },
      options: [
        { label: 'Crítica', color: '#bb3354' },
        { label: 'Alta', color: '#df2f4a' },
        { label: 'Média', color: '#fdab3d' },
        { label: 'Baixa', color: '#579bfc' },
      ],
    },
    { key: 'c_plano_acao', type: 'long_text', title: 'Plano de ação', width: 280 },
    { key: 'c_prazo', type: 'date', title: 'Prazo', width: 130 },
  ],
  statusColumnKey: 'c_status',
  viewName: 'Riscos e problemas',
});

const pmoWorkspace: WorkspaceTemplatePayload = parseTemplatePayload('workspace', {
  boards: [
    { name: 'Portfólio de projetos', blueprint: pmoPortfolioBoard },
    { name: 'Riscos e problemas', blueprint: pmoRisksBoard },
  ],
});

// ----------------------------------------------------------------------------------- seed ---

interface GlobalTemplateSeed {
  kind: 'board' | 'workspace';
  name: string;
  description: string;
  category: string;
  payload: BoardTemplatePayload | WorkspaceTemplatePayload;
}

function globalGallery(): GlobalTemplateSeed[] {
  const builtins = boardTemplates('pt-BR');
  const byKey = (key: string) => {
    const found = builtins.find((template) => template.key === key);
    if (found === undefined) throw new Error(`Template embutido ausente: ${key}`);
    return found;
  };
  return [
    // Os 4 templates embutidos (`board-templates.ts`), também publicados como templates globais —
    // mesma galeria, uma fonte única de verdade (a API cria o board a partir desta linha também).
    { kind: 'board', name: 'Board em branco', description: byKey('blank').description, category: 'Geral', payload: toPayload(byKey('blank')) },
    { kind: 'board', name: 'Projeto', description: byKey('project').description, category: 'Projetos', payload: toPayload(byKey('project')) },
    { kind: 'board', name: 'Solicitações', description: byKey('requests').description, category: 'Atendimento', payload: toPayload(byKey('requests')) },
    { kind: 'board', name: 'Ordens de serviço (UST)', description: byKey('service_orders').description, category: 'Contratos', payload: toPayload(byKey('service_orders')) },
    // 7 templates novos (Prompt 15).
    { kind: 'board', name: implantacaoBase.name, description: implantacaoBase.description, category: 'Projetos', payload: implantacaoBase },
    { kind: 'board', name: sustentacao.name, description: sustentacao.description, category: 'Suporte', payload: sustentacao },
    { kind: 'board', name: scrum.name, description: scrum.description, category: 'Ágil', payload: scrum },
    { kind: 'board', name: kanbanServicos.name, description: kanbanServicos.description, category: 'Atendimento', payload: kanbanServicos },
    {
      kind: 'workspace',
      name: 'PMO',
      description: 'Escritório de projetos: portfólio de projetos + riscos e problemas, em dois boards.',
      category: 'Portfólio',
      payload: pmoWorkspace,
    },
    { kind: 'board', name: onboarding.name, description: onboarding.description, category: 'Pessoas', payload: onboarding },
    { kind: 'board', name: contratosUst.name, description: contratosUst.description, category: 'Contratos', payload: contratosUst },
  ];
}

/**
 * Semeia a galeria PÚBLICA de templates (`tenant_id` nulo) — plataforma inteira, não um tenant
 * específico (ADR 0056). Idempotente: se já existir algum template global, não faz nada (a galeria
 * pública é gerida por quem opera a plataforma, não recriada a cada `db:seed`).
 */
export async function seedPublicTemplates(db: Database): Promise<SeedTemplatesResult> {
  const [existing] = await db.select({ id: templates.id }).from(templates).where(isNull(templates.tenantId)).limit(1);
  if (existing !== undefined) return { created: false, count: 0 };

  const gallery = globalGallery();
  await db.insert(templates).values(
    gallery.map((entry) => ({
      tenantId: null,
      kind: entry.kind,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      payload: entry.payload,
    })),
  );
  return { created: true, count: gallery.length };
}
