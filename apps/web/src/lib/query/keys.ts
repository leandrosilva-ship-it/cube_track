/**
 * Chaves padronizadas do TanStack Query (ADR 0033). Tudo de um board fica sob `['boards', id]`,
 * permitindo invalidar o board inteiro (ex.: resync após lacuna de eventos) com uma chave.
 */
import type { FilterGroup } from '@cube-track/shared';

export interface ActivityFilters {
  actorId?: string;
  columnKey?: string;
  from?: string;
  to?: string;
}

export interface ItemListParams {
  search?: string;
  personId?: string;
  statusLabelIds?: readonly string[];
  /** Filtro avançado (AST E/OU) montado no construtor de filtros. */
  filter?: FilterGroup;
  /** `campo:dir[,campo:dir…]` (até 3 termos). */
  sort?: string;
  /** Lista de subitens de um item (ausente = itens de primeiro nível). */
  parentItemId?: string;
}

export const qk = {
  me: () => ['me'] as const,
  organizations: () => ['organizations'] as const,
  members: () => ['members'] as const,
  roles: () => ['roles'] as const,
  workspaces: () => ['workspaces'] as const,
  tree: (workspaceId: string) => ['workspaces', workspaceId, 'tree'] as const,
  board: (boardId: string) => ['boards', boardId] as const,
  boardDetail: (boardId: string) => ['boards', boardId, 'detail'] as const,
  views: (boardId: string) => ['boards', boardId, 'views'] as const,
  shareLink: (viewId: string) => ['views', viewId, 'share-link'] as const,
  savedFilters: (boardId: string) => ['boards', boardId, 'saved-filters'] as const,
  items: (boardId: string) => ['boards', boardId, 'items'] as const,
  itemList: (boardId: string, params: ItemListParams) =>
    ['boards', boardId, 'items', params] as const,
  subitems: (boardId: string, parentItemId: string) =>
    ['boards', boardId, 'items', { parentItemId }] as const,
  trash: (boardId: string) => ['boards', boardId, 'trash'] as const,
  dependencies: (boardId: string) => ['boards', boardId, 'dependencies'] as const,
  gantt: (boardId: string) => ['boards', boardId, 'gantt'] as const,
  milestones: (boardId: string) => ['boards', boardId, 'milestones'] as const,
  baselines: (boardId: string) => ['boards', boardId, 'baselines'] as const,
  baseline: (baselineId: string) => ['baselines', baselineId] as const,
  forms: (boardId: string) => ['boards', boardId, 'forms'] as const,
  form: (formId: string) => ['forms', formId] as const,
  formFields: (formId: string) => ['forms', formId, 'fields'] as const,
  publicForm: (token: string) => ['public-forms', token] as const,
  item: (itemId: string) => ['items', itemId, 'detail'] as const,
  updates: (itemId: string) => ['items', itemId, 'updates'] as const,
  replies: (updateId: string) => ['updates', updateId, 'replies'] as const,
  activity: (itemId: string, filters: ActivityFilters) =>
    ['items', itemId, 'activity', filters] as const,
  activityActors: (itemId: string) => ['items', itemId, 'activity-actors'] as const,
  checklists: (itemId: string) => ['items', itemId, 'checklists'] as const,
  follow: (itemId: string) => ['items', itemId, 'follow'] as const,
  approvals: (itemId: string) => ['items', itemId, 'approvals'] as const,
  itemFiles: (itemId: string) => ['items', itemId, 'files'] as const,
  fileVersions: (attachmentId: string) => ['files', attachmentId, 'versions'] as const,
  boardTemplates: () => ['board-templates'] as const,
  boardsOf: (workspaceId: string) => ['workspaces', workspaceId, 'boards'] as const,
  grants: (resourceType: string, resourceId: string) =>
    ['access-grants', resourceType, resourceId] as const,
  favorites: () => ['me', 'favorites'] as const,
  notifications: () => ['me', 'notifications'] as const,
  notificationList: (unreadOnly: boolean) =>
    ['me', 'notifications', 'list', { unreadOnly }] as const,
  unreadCount: () => ['me', 'notifications', 'unread-count'] as const,
  notificationPreferences: () => ['me', 'notification-preferences'] as const,
  week: (date: string) => ['me', 'week', date] as const,
  search: (query: string) => ['search', query] as const,
  dashboardsOf: (workspaceId: string) => ['workspaces', workspaceId, 'dashboards'] as const,
  dashboard: (dashboardId: string) => ['dashboards', dashboardId] as const,
  dashboardWidgets: (dashboardId: string) => ['dashboards', dashboardId, 'widgets'] as const,
  dashboardData: (dashboardId: string) => ['dashboards', dashboardId, 'data'] as const,
  projectHealth: (boardId: string) => ['boards', boardId, 'project-health'] as const,
  automations: (boardId: string) => ['boards', boardId, 'automations'] as const,
  processConfig: (boardId: string) => ['boards', boardId, 'process-config'] as const,
  slas: (boardId: string) => ['boards', boardId, 'slas'] as const,
  slaTrackers: (boardId: string) => ['boards', boardId, 'sla-trackers'] as const,
  webhooksOfBoard: (boardId: string) => ['boards', boardId, 'webhooks'] as const,
  resourceProfiles: () => ['resource-profiles'] as const,
  resourceProfile: (userId: string) => ['users', userId, 'resource-profile'] as const,
  teams: () => ['teams'] as const,
  skills: () => ['skills'] as const,
  userSkills: (userId: string) => ['users', userId, 'skills'] as const,
  allocationsOfBoard: (boardId: string, from?: string, to?: string) =>
    ['boards', boardId, 'allocations', { from, to }] as const,
  allocationsOfUser: (userId: string, from: string, to: string) =>
    ['users', userId, 'allocations', { from, to }] as const,
  absencesOfUser: (userId: string) => ['users', userId, 'absences'] as const,
  pendingAbsences: () => ['absences', 'pending'] as const,
  resourceRequestsOfBoard: (boardId: string) => ['boards', boardId, 'resource-requests'] as const,
  openResourceRequests: () => ['resource-requests', 'open'] as const,
  capacityHeatmap: (params: CapacityScopeParams) => ['capacity', 'heatmap', params] as const,
  capacityLeveling: (params: CapacityScopeParams) => ['capacity', 'leveling', params] as const,
  capacityForecast: (months: number) => ['capacity', 'forecast', months] as const,
  timeEntriesOfUser: (userId: string, from: string, to: string) =>
    ['users', userId, 'time-entries', { from, to }] as const,
  timeEntriesOfItem: (itemId: string) => ['items', itemId, 'time-entries'] as const,
  timesheetApprovalsOfUser: (userId: string) => ['users', userId, 'timesheet-approvals'] as const,
  timesheetApprovalsPending: () => ['timesheet-approvals', 'pending'] as const,
  portfoliosOf: (workspaceId: string) => ['workspaces', workspaceId, 'portfolios'] as const,
  portfolio: (id: string) => ['portfolios', id] as const,
  portfolioRollup: (id: string) => ['portfolios', id, 'rollup'] as const,
  portfolioStatusReport: (id: string) => ['portfolios', id, 'status-report'] as const,
  programsOf: (workspaceId: string) => ['workspaces', workspaceId, 'programs'] as const,
  program: (id: string) => ['programs', id] as const,
  programRollup: (id: string) => ['programs', id, 'rollup'] as const,
  programStatusReport: (id: string) => ['programs', id, 'status-report'] as const,
  scoringModels: () => ['scoring-models'] as const,
  scoringRanking: (modelId: string) => ['scoring-models', modelId, 'ranking'] as const,
  scoringValueEffort: (modelId: string) => ['scoring-models', modelId, 'value-effort'] as const,
  stageGatesOfBoard: (boardId: string) => ['boards', boardId, 'stage-gates'] as const,
  risksOfBoard: (boardId: string) => ['boards', boardId, 'risks'] as const,
  issuesOfBoard: (boardId: string) => ['boards', boardId, 'issues'] as const,
  budgetsOfBoard: (boardId: string) => ['boards', boardId, 'budgets'] as const,
  costEntriesOfBudget: (budgetId: string) => ['budgets', budgetId, 'cost-entries'] as const,
  healthRulesDefault: () => ['health-rules', 'default'] as const,
  healthRulesOfBoard: (boardId: string) => ['boards', boardId, 'health-rules'] as const,
  boardStatusReport: (boardId: string) => ['boards', boardId, 'status-report'] as const,
};

export interface CapacityScopeParams {
  from: string;
  to: string;
  granularity?: 'day' | 'week' | 'month';
  userIds?: string;
  teamIds?: string;
  skillId?: string;
  boardId?: string;
}

/** Há filtros que o cache local não sabe avaliar? (então eventos invalidam em vez de inserir) */
export function isFiltered(params: ItemListParams): boolean {
  return (
    (params.search ?? '') !== '' ||
    params.personId !== undefined ||
    (params.statusLabelIds?.length ?? 0) > 0 ||
    (params.filter?.conditions.length ?? 0) > 0 ||
    params.sort !== undefined
  );
}
