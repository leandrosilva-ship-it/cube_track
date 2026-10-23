import { z } from 'zod';

/**
 * Views salvas de um board (ADR 0044). `config` é específico do tipo; `filters`/`sort`/`groupBy`
 * reusam a mesma AST de filtro do resto do produto. Tudo aqui é compartilhado entre API e web para
 * que o cliente valide e preencha os mesmos formatos que o servidor grava.
 */

export const VIEW_TYPES = [
  'table',
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'form',
  'map',
  'chart',
  'files',
  'workload',
  'dashboard',
] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/** Tipos de view com uma tela própria neste momento do produto (os demais mostram "em breve"). */
export const IMPLEMENTED_VIEW_TYPES = new Set<ViewType>([
  'table',
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'form',
  'dashboard',
]);

export function isViewType(value: string): value is ViewType {
  return (VIEW_TYPES as readonly string[]).includes(value);
}

/** Ordenação salva na view (nome de coluna igual ao do schema: `columnKey`, não `field`). */
export const ViewSortTermSchema = z
  .object({ columnKey: z.string().min(1).max(64), direction: z.enum(['asc', 'desc']) })
  .strict();
export type ViewSortTerm = z.infer<typeof ViewSortTermSchema>;
export const ViewSortSchema = z.array(ViewSortTermSchema).max(3);

/** Converte a ordenação salva para `field:dir,...` (parâmetro de consulta de itens). */
export function viewSortToQueryString(terms: readonly ViewSortTerm[]): string | undefined {
  return terms.length === 0
    ? undefined
    : terms.map((term) => `${term.columnKey}:${term.direction}`).join(',');
}

/** Agrupamento salvo: até 3 níveis (`'group'` ou chave de coluna), igual ao que a Tabela usa. */
export const ViewGroupBySchema = z
  .object({ levels: z.array(z.string().min(1).max(64)).min(1).max(3) })
  .strict();
export type ViewGroupBy = z.infer<typeof ViewGroupBySchema>;

export const KANBAN_CARD_DENSITIES = ['compact', 'detailed'] as const;
export type KanbanCardDensity = (typeof KANBAN_CARD_DENSITIES)[number];

/** Configuração da view Kanban: colunas e raias por campo, cartões, limites de WIP. */
export const KanbanConfigSchema = z
  .object({
    /** `'group'` ou chave de uma coluna status/lista/pessoas/caixa/tags. */
    columnsBy: z.string().min(1).max(64).default('group'),
    /** `'group'` ou chave de coluna; ausente = sem raias. */
    swimlanesBy: z.string().min(1).max(64).optional(),
    cardFields: z.array(z.string().min(1).max(64)).max(10).default([]),
    cardDensity: z.enum(KANBAN_CARD_DENSITIES).default('detailed'),
    showCover: z.boolean().default(false),
    /** Chave de coluna (normalmente status) que colore a capa do cartão. */
    colorBy: z.string().min(1).max(64).optional(),
    /** Limite de itens por coluna (chave = id do rótulo/opção/pessoa/grupo/tag). */
    wipLimits: z.record(z.string(), z.number().int().min(1).max(9_999)).default({}),
    /** Impede soltar um cartão numa coluna acima do limite (além de alertar). */
    wipBlock: z.boolean().default(false),
    hideEmptyColumns: z.boolean().default(false),
    collapsedColumnKeys: z.array(z.string().max(64)).max(100).default([]),
  })
  .strict();
export type KanbanConfig = z.infer<typeof KanbanConfigSchema>;

export function defaultKanbanConfig(columnsBy = 'group'): KanbanConfig {
  return KanbanConfigSchema.parse({ columnsBy });
}

/** Configuração da view Tabela: layout de colunas (o restante vem de `filters`/`sort`/`groupBy`). */
export const TableConfigSchema = z
  .object({
    columnOrder: z.array(z.string().max(64)).max(300).optional(),
    columnWidths: z.record(z.string(), z.number().int().min(40).max(2_000)).optional(),
    pinnedColumnKeys: z.array(z.string().max(64)).max(50).optional(),
    collapsedGroupPaths: z.array(z.string().max(400)).max(1_000).optional(),
  })
  .strict();
export type TableConfig = z.infer<typeof TableConfigSchema>;

/** Configuração da view Calendário: coluna de data (+ secundária, ex. replanejado) e cor. */
export const CalendarConfigSchema = z
  .object({
    /** Coluna de data ou intervalo usada para posicionar o item no calendário. */
    dateColumnKey: z.string().min(1).max(64).default('plannedStartDate'),
    /** Segunda data mostrada no mesmo item (ex.: término replanejado ao lado do planejado). */
    secondaryDateColumnKey: z.string().min(1).max(64).optional(),
    /** Coluna (normalmente status) que colore o item no calendário. */
    colorBy: z.string().min(1).max(64).optional(),
    defaultView: z.enum(['month', 'week', 'day']).default('month'),
  })
  .strict();
export type CalendarConfig = z.infer<typeof CalendarConfigSchema>;

export const TIMELINE_ZOOMS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

/** Configuração da view Timeline/Roadmap: barras por intervalo, agrupadas e com marcos. */
export const TimelineConfigSchema = z
  .object({
    startColumnKey: z.string().min(1).max(64).default('plannedStartDate'),
    endColumnKey: z.string().min(1).max(64).default('plannedEndDate'),
    /** `'group'`, chave de coluna de pessoas, ou outra coluna de agrupamento. */
    groupBy: z.string().min(1).max(64).default('group'),
    colorBy: z.string().min(1).max(64).optional(),
    zoom: z.enum(TIMELINE_ZOOMS).default('month'),
    showMilestones: z.boolean().default(true),
    showToday: z.boolean().default(true),
  })
  .strict();
export type TimelineConfig = z.infer<typeof TimelineConfigSchema>;

/** Configuração da view Gantt/Cronograma: datas, caminho crítico, baseline e agrupamento. */
export const GanttConfigSchema = z
  .object({
    startColumnKey: z.string().min(1).max(64).default('plannedStartDate'),
    endColumnKey: z.string().min(1).max(64).default('plannedEndDate'),
    groupBy: z.enum(['group', 'none']).default('group'),
    showCriticalPath: z.boolean().default(false),
    showWbs: z.boolean().default(true),
    baselineCompare: z.boolean().default(false),
    /** Baseline comparada; ausente + `baselineCompare` usa a baseline primária do board. */
    baselineId: z.uuid().optional(),
    zoom: z.enum(TIMELINE_ZOOMS).default('week'),
  })
  .strict();
export type GanttConfig = z.infer<typeof GanttConfigSchema>;

/** Configuração da view Formulário: só referencia o formulário (o formulário é a fonte da verdade). */
export const FormViewConfigSchema = z.object({ formId: z.uuid().optional() }).strict();
export type FormViewConfig = z.infer<typeof FormViewConfigSchema>;

/**
 * Configuração da view Dashboard: só referencia o dashboard (entidade de workspace, ADR 0050) que é
 * embutido inline nas abas do board — o dashboard é a fonte da verdade dos widgets, não a view.
 */
export const DashboardConfigSchema = z.object({ dashboardId: z.uuid().optional() }).strict();
export type DashboardViewConfig = z.infer<typeof DashboardConfigSchema>;

/** Configurações de outros tipos de view (ainda sem tela própria): forma livre, limitada em tamanho. */
export const GenericViewConfigSchema = z.record(z.string(), z.unknown());

/** Valida/normaliza `config` conforme o tipo da view (aplica os defaults do tipo). */
export function parseViewConfig(type: ViewType, raw: unknown): Record<string, unknown> {
  if (type === 'kanban') return KanbanConfigSchema.parse(raw ?? {});
  if (type === 'table') return TableConfigSchema.parse(raw ?? {});
  if (type === 'calendar') return CalendarConfigSchema.parse(raw ?? {});
  if (type === 'timeline') return TimelineConfigSchema.parse(raw ?? {});
  if (type === 'gantt') return GanttConfigSchema.parse(raw ?? {});
  if (type === 'form') return FormViewConfigSchema.parse(raw ?? {});
  if (type === 'dashboard') return DashboardConfigSchema.parse(raw ?? {});
  return GenericViewConfigSchema.parse(raw ?? {});
}
