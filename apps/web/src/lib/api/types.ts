/** Tipos das respostas da API REST v1 consumidas pela interface (contrato em docs/openapi.json). */

import type {
  AutomationActionSpec,
  AutomationTriggerSpec,
  ConditionGroup,
  FilterGroup,
  ViewGroupBy,
  ViewSortTerm,
} from '@cube-track/shared';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  mfaEnabled: boolean;
}

export interface SessionTenant {
  id: string;
  slug: string;
  name: string;
}

export interface SessionResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  sessionId: string;
  user: SessionUser;
  tenant: SessionTenant;
}

export interface MfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  expiresIn: number;
}

export type LoginResponse = SessionResponse | MfaChallenge;

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    locale: string;
    timezone: string;
    mfaEnabled: boolean;
  };
  tenant: { id: string; kind: 'member' | 'guest'; roleKey: string; permissions: string[] };
}

export interface Organization {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  kind: 'member' | 'guest';
  roleKey: string;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  kind: 'member' | 'guest';
  status: 'active' | 'invited' | 'suspended';
  roleId: string;
  jobTitle: string | null;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  scope: 'tenant' | 'workspace' | 'board';
  isSystem: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  visibility: 'open' | 'closed';
  enabledModules: string[];
}

export type BoardKind = 'board' | 'project' | 'process' | 'backlog';
export type BoardVisibility = 'main' | 'private' | 'shareable';

export interface TreeFolder {
  id: string;
  parentId: string | null;
  name: string;
  color: string | null;
  position: string;
}

export interface TreeBoard {
  id: string;
  workspaceId: string;
  folderId: string | null;
  kind: BoardKind;
  name: string;
  description: string | null;
  visibility: BoardVisibility;
  position: string;
}

export interface WorkspaceTree {
  workspaceId: string;
  canManageFolders: boolean;
  canCreateBoards: boolean;
  canManageResources: boolean;
  canApproveTimesheet: boolean;
  canManagePortfolio: boolean;
  canReadPortfolio: boolean;
  canManageWorkspace: boolean;
  canReadContracts: boolean;
  canManageContracts: boolean;
  canMeasureContracts: boolean;
  folders: TreeFolder[];
  boards: TreeBoard[];
}

export interface StatusLabel {
  id: string;
  columnId: string;
  label: string;
  color: string;
  category: 'not_started' | 'in_progress' | 'done' | 'stuck';
  position: string;
}

export interface ColumnPrincipals {
  roleIds?: string[];
  userIds?: string[];
  teamIds?: string[];
}

export interface BoardColumn {
  id: string;
  key: string;
  type: string;
  title: string;
  description: string | null;
  settings: Record<string, unknown>;
  binding: string | null;
  isRequired: boolean;
  /** Obrigatória quando o item casa com esta condição (AST de filtro; ADR 0039). */
  requiredWhen: FilterGroup | null;
  defaultValue: Record<string, unknown> | null;
  isHidden: boolean;
  position: string;
  width: number | null;
  permissions: { viewers?: ColumnPrincipals; editors?: ColumnPrincipals };
  canEdit: boolean;
  labels: StatusLabel[];
  options: {
    id: string;
    columnId: string;
    label: string;
    color: string | null;
    position: string;
  }[];
}

export interface BoardGroup {
  id: string;
  name: string;
  color: string;
  position: string;
  isCollapsed: boolean;
}

export interface BoardSettings {
  /** Coluna de status principal (conclusão, atrasados). */
  statusColumnKey?: string;
  [key: string]: unknown;
}

export interface BoardDetail {
  id: string;
  workspaceId: string;
  folderId: string | null;
  kind: BoardKind;
  name: string;
  description: string | null;
  icon: string | null;
  visibility: BoardVisibility;
  terminology: { singular: string; plural: string };
  settings: BoardSettings;
  isTemplate: boolean;
  seq: number;
  /** Contrato (ADR 0054) ao qual este board está vinculado, ou `null` fora do módulo Contratos/OS/UST. */
  contractId: string | null;
  permissions: string[];
  itemScope: 'all' | 'assigned';
  groups: BoardGroup[];
  columns: BoardColumn[];
}

export type ViewType =
  | 'table'
  | 'kanban'
  | 'calendar'
  | 'timeline'
  | 'gantt'
  | 'form'
  | 'map'
  | 'chart'
  | 'files'
  | 'workload'
  | 'dashboard';

export interface BoardView {
  id: string;
  boardId: string;
  name: string;
  type: ViewType;
  ownerId: string | null;
  /** Específico do tipo (ex.: `KanbanConfig` para `kanban`) — ver `parseViewConfig` em shared. */
  config: Record<string, unknown>;
  filters: FilterGroup | null;
  sort: ViewSortTerm[];
  groupBy: ViewGroupBy | null;
  hiddenColumnKeys: string[];
  isDefault: boolean;
  isLocked: boolean;
  isRestricted: boolean;
  position: string;
  personal: boolean;
  canEdit: boolean;
}

export interface ViewList {
  canManage: boolean;
  data: BoardView[];
}

export interface ShareLinkSettings {
  hiddenColumnKeys: string[];
  allowSearch: boolean;
}

export interface ShareLinkStatus {
  exists: boolean;
  requiresPassword?: boolean;
  expiresAt?: string | null;
  revokedAt?: string | null;
  accessCount?: number;
  lastAccessedAt?: string | null;
  settings?: ShareLinkSettings;
}

export interface ShareLinkResult {
  /** Em claro — só vem preenchido logo após criar/regenerar; não é recuperável depois. */
  token: string | null;
  path: string;
  requiresPassword: boolean;
  expiresAt: string | null;
  settings: ShareLinkSettings;
}

export interface SavedFilter {
  id: string;
  boardId: string;
  ownerId: string;
  name: string;
  filter: FilterGroup;
  isShared: boolean;
  mine: boolean;
}

export interface Item {
  id: string;
  boardId: string;
  groupId: string;
  parentItemId: string | null;
  name: string;
  position: string;
  /** Fase corrente (board `kind: 'process'`, ADR 0051) — `null` fora de um pipe. */
  phaseId: string | null;
  phaseEnteredAt: string | null;
  values: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  version: number;
  descriptionText: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  progress: string | null;
  /** Marco do cronograma (losango de duração zero no Gantt). */
  isMilestone: boolean;
  /** `manual`: o recálculo automático de dependências nunca empurra este item (ADR 0049). */
  scheduleMode: 'auto' | 'manual';
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  archivedAt: string | null;
  /** Indicadores da linha (pedidos com `indicators=true`). */
  indicators?: ItemIndicators;
  redactedFields: string[];
}

export interface ItemIndicators {
  subitems: number;
  attachments: number;
  updates: number;
  unreadUpdates: number;
}

export interface Page<T> {
  data: T[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

export type FavoriteType = 'workspace' | 'folder' | 'board';

export interface Favorite {
  entityType: FavoriteType;
  entityId: string;
  name: string;
  workspaceId: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  boardId: string | null;
  itemId: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorAvatarUrl: string | null;
}

export interface NotificationPage extends Page<Notification> {
  unreadCount: number;
}

export interface WeekItem {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
  workspaceId: string;
  groupName: string;
  dueDate: string;
  overdue: boolean;
}

export interface Week {
  from: string;
  to: string;
  data: WeekItem[];
}

export interface SearchHit {
  id: string;
  type: 'items' | 'boards' | 'updates';
  title: string;
  boardId: string;
  itemId: string | null;
  snippet: string | null;
}

export interface AccessGrant {
  id: string;
  resourceType: 'workspace' | 'board' | 'view' | 'item';
  resourceId: string;
  principalType: 'user' | 'team';
  principalId: string;
  roleId: string;
  expiresAt: string | null;
}

export interface InvitationPreview {
  organization: { name: string; slug: string };
  email: string;
  kind: 'member' | 'guest';
  expiresAt: string;
  accountExists: boolean;
}

export interface TrashEntry {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  parentItemId: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  expiresAt: string | null;
}

export interface Trash {
  items: TrashEntry[];
  groups: {
    id: string;
    name: string;
    color: string;
    deletedAt: string | null;
    expiresAt: string | null;
  }[];
}

export type ImportTarget = 'name' | 'group' | `column:${string}` | null;

export interface ImportPreview {
  importId: string;
  fileName: string;
  headers: string[];
  sample: string[][];
  totalRows: number;
  suggestedMapping: Record<string, ImportTarget>;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; column: string | null; message: string }[];
}

export interface BoardTemplates {
  builtin: {
    kind: 'builtin';
    key: string;
    name: string;
    description: string;
    icon: string;
    boardKind: string;
    groups: string[];
    columns: { title: string; type: string }[];
  }[];
  boards: {
    kind: 'board';
    boardId: string;
    name: string;
    description: string | null;
    icon: string | null;
    boardKind: string;
  }[];
}

export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: 'FS' | 'SS' | 'FF' | 'SF';
  lagDays: number;
}

// ------------------------------------------------------------------- painel do item (Prompt 7) ---

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface ItemUpdate {
  id: string;
  itemId: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: Record<string, unknown>;
  bodyText: string;
  isPinned: boolean;
  source: 'app' | 'email';
  editedAt: string | null;
  editCount: number;
  canEdit: boolean;
  createdAt: string;
  replyCount: number;
  reactions: ReactionSummary[];
}

export interface UpdateFeed {
  pinned: ItemUpdate[];
  data: ItemUpdate[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

export interface ItemReply {
  id: string;
  updateId: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  body: Record<string, unknown>;
  bodyText: string;
  source: 'app' | 'email';
  editedAt: string | null;
  editCount: number;
  canEdit: boolean;
  createdAt: string;
  reactions: ReactionSummary[];
}

export interface ActivityLogEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  columnKey: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actorId: string | null;
  actorKind: string;
  actorName: string | null;
  actorAvatarUrl: string | null;
}

export interface ActivityActor {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface ChecklistItemRow {
  id: string;
  content: string;
  isDone: boolean;
  doneAt: string | null;
  doneBy: string | null;
  assigneeId: string | null;
  dueDate: string | null;
  position: string;
}

export interface Checklist {
  id: string;
  itemId: string;
  title: string;
  position: string;
  items: ChecklistItemRow[];
  progress: { done: number; total: number };
}

export interface FollowStatus {
  following: boolean;
  followers: { id: string; name: string; avatarUrl: string | null }[];
}

export interface Approver {
  userId: string;
  name: string;
  avatarUrl: string | null;
  decision: 'approved' | 'rejected' | null;
  comment: string | null;
  decidedAt: string | null;
}

export interface ApprovalRequest {
  id: string;
  itemId: string;
  mode: 'all' | 'any';
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  approvers: Approver[];
  canDecide: boolean;
}

export interface AttachmentSummary {
  id: string;
  fileName: string;
  currentVersion: number;
  createdAt: string;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'pending' | 'clean' | 'infected' | 'error';
}

export interface AttachmentVersion {
  version: number;
  mimeType: string;
  sizeBytes: number;
  scanStatus: 'pending' | 'clean' | 'infected' | 'error';
  createdAt: string;
  createdBy: string | null;
  isCurrent: boolean;
}

// -------------------------------------------------------------------- Prompt 8: planejamento ---

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface GanttTask {
  id: string;
  parentItemId: string | null;
  groupId: string;
  name: string;
  wbs: string | null;
  position: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  start: string | null;
  end: string | null;
  progress: string | null;
  isMilestone: boolean;
  scheduleMode: 'auto' | 'manual';
}

export interface GanttDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  lagDays: number;
}

export interface CriticalPathEntry {
  id: string;
  earlyStart: string;
  earlyFinish: string;
  lateStart: string;
  lateFinish: string;
  totalFloatDays: number;
  isCritical: boolean;
}

export interface GanttData {
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  criticalPath: CriticalPathEntry[];
  calendar: { workingDays: number[]; holidays: string[] };
}

export interface Milestone {
  id: string;
  boardId: string;
  itemId: string | null;
  name: string;
  description: string | null;
  dueDate: string;
  status: 'pending' | 'achieved' | 'missed' | 'cancelled';
  achievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Baseline {
  id: string;
  boardId: string;
  name: string;
  description: string | null;
  capturedAt: string;
  isPrimary: boolean;
}

export interface BaselineComparisonRow {
  itemId: string;
  itemName: string;
  baselineStartDate: string | null;
  baselineEndDate: string | null;
  baselineProgress: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  currentProgress: string | null;
}

export interface BaselineDetail extends Baseline {
  items: BaselineComparisonRow[];
}

export interface SchedulePreview {
  importId: string;
  fileName: string;
  totalTasks: number;
  sample: { name: string; start: string | null; finish: string | null; milestone: boolean }[];
  dependencyCount: number;
  warnings: string[];
}

export interface ScheduleImportResult {
  created: number;
  skipped: number;
  dependenciesCreated: number;
  errors: { task: string; message: string }[];
}

// -------------------------------------------------------------------------- Prompt 8: forms ---

export interface FormBranding {
  logoUrl: string | null;
  primaryColor: string | null;
  thankYouMessage: string | null;
  redirectUrl: string | null;
}

export interface FormDefinition {
  id: string;
  boardId: string;
  targetGroupId: string | null;
  name: string;
  description: string | null;
  isPublic: boolean;
  requiresLogin: boolean;
  isActive: boolean;
  closesAt: string | null;
  settings: FormBranding;
  hasPublicLink: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FormField {
  id: string;
  formId: string;
  columnKey: string | null;
  label: string;
  helpText: string | null;
  fieldType: string;
  isRequired: boolean;
  showWhen: FilterGroup | null;
  settings: Record<string, unknown>;
  position: string;
}

export interface PublicFormField extends FormField {
  columnType: string | null;
  labels: { id: string; label: string; color: string; category: string }[];
  options: { id: string; label: string; color: string | null }[];
}

export interface PublicFormDefinition {
  formId: string;
  boardId: string;
  name: string;
  description: string | null;
  requiresLogin: boolean;
  branding: FormBranding;
  fields: PublicFormField[];
  captcha: { token: string; question: string } | null;
}

// --------------------------------------------------------------------------- dashboards ---

export type WidgetType =
  | 'number'
  | 'chart_bar'
  | 'chart_pie'
  | 'battery'
  | 'workload'
  | 'project_health'
  | 'capacity'
  | 'portfolio_rollup'
  | 'risk_heatmap'
  | 'budget_variance'
  | 'ust_balance'
  | 'ust_by_dimension'
  | 'ust_forecast';

export interface Dashboard {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  name: string;
  description: string | null;
  visibility: 'private' | 'workspace';
  sourceBoardIds: string[];
  filters: Record<string, unknown> | null;
  refreshIntervalSeconds: number | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Widget {
  id: string;
  dashboardId: string;
  type: WidgetType;
  title: string;
  config: Record<string, unknown>;
  layout: WidgetLayout;
  createdAt: string;
  updatedAt: string;
}

export type HealthStatus = 'green' | 'yellow' | 'red' | 'grey';

export type WidgetData =
  | { kind: 'number'; value: string | null }
  | {
      kind: 'chart';
      categories: { key: string; label: string; value: number; color: string | null }[];
    }
  | {
      kind: 'battery';
      onTime: number;
      replanned: number;
      late: number;
      noDate: number;
      total: number;
    }
  | { kind: 'workload'; people: { personId: string; personName: string; value: number }[] }
  | {
      kind: 'project_health';
      latest: ProjectHealthEntry | null;
      history: { id: string; reportedAt: string; overall: HealthStatus; isAutomatic: boolean }[];
    }
  | {
      kind: 'capacity';
      granularity: CapacityGranularity;
      rows: { userId: string; userName: string; buckets: CapacityBucket[] }[];
    }
  | { kind: 'portfolio_rollup'; scope: 'portfolio' | 'program'; name: string | null; rollup: RollupResult }
  | {
      kind: 'risk_heatmap';
      risks: { id: string; title: string; boardId: string; probability: number; impact: number; status: string }[];
    }
  | {
      kind: 'budget_variance';
      budgets: {
        budgetId: string;
        boardId: string | null;
        boardName: string | null;
        name: string;
        category: 'capex' | 'opex';
        plannedAmount: string;
        actualAmount: string;
        forecastAmount: string;
      }[];
    }
  | { kind: 'ust_balance'; contractId: string; contractNumber: string; balance: ContractBalance }
  | {
      kind: 'ust_by_dimension';
      dimension: 'month' | 'column';
      categories: { key: string; label: string; value: number }[];
    }
  | {
      kind: 'ust_forecast';
      contractId: string;
      balance: ContractBalance;
      forecast: { dailyBurnRate: number; estimatedExhaustionDate: string | null };
    };

export interface DashboardWidgetData {
  widgetId: string;
  type: WidgetType;
  data: WidgetData;
}

export interface ProjectHealthEntry {
  id: string;
  boardId: string;
  reportedBy: string | null;
  reportedAt: string;
  overall: HealthStatus;
  schedule: HealthStatus;
  cost: HealthStatus;
  scope: HealthStatus;
  quality: HealthStatus;
  risk: HealthStatus;
  percentComplete: string | null;
  spi: string | null;
  cpi: string | null;
  summary: string | null;
  isAutomatic: boolean;
  overrideReason: string | null;
  plannedValue: string | null;
  earnedValue: string | null;
  actualCost: string | null;
  eac: string | null;
  vac: string | null;
}

// --------------------------------------------------------------------------- automações ---

export interface Automation {
  id: string;
  workspaceId: string;
  boardId: string | null;
  name: string;
  description: string | null;
  trigger: AutomationTriggerSpec;
  conditions: ConditionGroup | null;
  actions: AutomationActionSpec[];
  isEnabled: boolean;
  ownerId: string | null;
  templateKey: string | null;
  runCount: number;
  errorCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// -------------------------------------------------------------------------- processos/SLA ---

export type PhaseKind = 'start' | 'intermediate' | 'done' | 'cancelled';

export interface Pipe {
  id: string;
  boardId: string;
  name: string;
  description: string | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Phase {
  id: string;
  pipeId: string;
  groupId: string;
  name: string;
  description: string | null;
  kind: PhaseKind;
  requiredColumnKeys: string[];
  formId: string | null;
  wipLimit: number | null;
  position: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransitionRule {
  id: string;
  pipeId: string;
  fromPhaseId: string | null;
  toPhaseId: string;
  conditions: Record<string, unknown> | null;
  requiredColumnKeys: string[];
  allowedRoleIds: string[];
  requiresApproval: boolean;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessConfig {
  pipe: Pipe | null;
  phases: Phase[];
  transitionRules: TransitionRule[];
}

export type SlaTrackerStatus = 'running' | 'paused' | 'met' | 'breached' | 'stopped';

export interface Sla {
  id: string;
  boardId: string;
  pipeId: string | null;
  phaseId: string | null;
  name: string;
  targetMinutes: number;
  warningPercent: number;
  useBusinessTime: boolean;
  workCalendarId: string | null;
  startCondition: Record<string, unknown> | null;
  stopCondition: Record<string, unknown> | null;
  pauseCondition: Record<string, unknown> | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlaTracker {
  id: string;
  slaId: string;
  itemId: string;
  status: SlaTrackerStatus;
  startedAt: string;
  dueAt: string;
  warningAt: string | null;
}

// ----------------------------------------------------------------------------- webhooks ---

export interface Webhook {
  id: string;
  workspaceId: string;
  boardId: string | null;
  name: string;
  url: string;
  events: string[];
  headers: Record<string, string>;
  isEnabled: boolean;
  consecutiveFailures: number;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Só na criação e na regeneração: o segredo HMAC em texto simples (nunca mais é devolvido). */
export interface WebhookWithSecret extends Webhook {
  secret: string;
}

// --------------------------------------------------------------- preferências de notificação ---

export type NotificationChannel = 'in_app' | 'email' | 'push';
/** `'weekly'` existe no banco mas nenhuma rotina de digest a esvazia hoje — fora da API (ADR 0051). */
export type NotificationFrequency = 'instant' | 'hourly' | 'daily' | 'never';

export interface NotificationPreference {
  id: string;
  channel: NotificationChannel;
  eventType: string;
  enabled: boolean;
  frequency: NotificationFrequency;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------- capacity, recursos e timesheet (ADR 0052) ---

export interface ResourceProfile {
  userId: string;
  userName: string;
  jobTitle: string | null;
  department: string | null;
  managerId: string | null;
  managerName: string | null;
  capacityHoursPerWeek: string;
  costRateHour: string | null;
  billRateHour: string | null;
  workCalendarId: string | null;
  location: string | null;
}

export interface Team {
  id: string;
  name: string;
}

export interface Skill {
  id: string;
  name: string;
  category: string | null;
}

export interface UserSkill {
  skillId: string;
  skillName: string;
  level: number;
}

export type AllocationStatus = 'tentative' | 'confirmed';

export interface Allocation {
  id: string;
  userId: string;
  boardId: string;
  itemId: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: string;
  status: AllocationStatus;
  notes: string | null;
}

export type AbsenceType = 'vacation' | 'sick_leave' | 'training' | 'day_off' | 'other';
export type AbsenceStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface Absence {
  id: string;
  userId: string;
  type: AbsenceType;
  startDate: string;
  endDate: string;
  hoursPerDay: string | null;
  status: AbsenceStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
}

export type ResourceRequestStatus = 'open' | 'fulfilled' | 'cancelled';

export interface ResourceRequest {
  id: string;
  boardId: string;
  itemId: string | null;
  skillId: string | null;
  roleTitle: string;
  hours: string;
  startDate: string;
  endDate: string;
  status: ResourceRequestStatus;
  assignedUserId: string | null;
  notes: string | null;
}

export type CapacityGranularity = 'day' | 'week' | 'month';

export interface CapacityBucket {
  bucket: string;
  nominalHours: number;
  availableHours: number;
  allocatedHours: number;
  utilization: number;
  overallocated: boolean;
}

export interface CapacityHeatmapRow {
  userId: string;
  userName: string;
  teamIds: string[];
  skillIds: string[];
  buckets: CapacityBucket[];
}

export interface CapacityHeatmapResponse {
  from: string;
  to: string;
  granularity: CapacityGranularity;
  rows: CapacityHeatmapRow[];
}

export interface LevelingSuggestion {
  userId: string;
  allocationId: string;
  fromDate: string;
  toDate: string;
  hours: number;
}

export interface ForecastBucket {
  month: string;
  capacityHours: number;
  demandHours: number;
  gapHours: number;
}

export interface WhatIfResponse {
  real: CapacityBucket[];
  simulated: CapacityBucket[];
}

// ----------------------------------------------------------------------------- timesheet ---

export type TimeEntrySource = 'manual' | 'timer' | 'import' | 'api';
export type TimeEntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface TimeEntry {
  id: string;
  userId: string;
  boardId: string;
  itemId: string;
  entryDate: string;
  minutes: number;
  description: string | null;
  isBillable: boolean;
  source: TimeEntrySource;
  startedAt: string | null;
  endedAt: string | null;
  status: TimeEntryStatus;
  approvalId: string | null;
}

export interface CreateTimeEntryInput {
  boardId: string;
  itemId: string;
  entryDate: string;
  minutes: number;
  description?: string | null;
  isBillable?: boolean;
}

export interface UpdateTimeEntryInput {
  entryDate?: string;
  minutes?: number;
  description?: string | null;
  isBillable?: boolean;
}

export interface TimesheetApproval {
  id: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  status: TimeEntryStatus;
  totalMinutes: number;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  comment: string | null;
}

// ----------------------------------------------------------------------------- portfólio ---

export type LifecycleStatus = 'proposed' | 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';

export interface Portfolio {
  id: string;
  workspaceId: string;
  folderId: string | null;
  name: string;
  description: string | null;
  ownerId: string | null;
  scoringModelId: string | null;
  status: LifecycleStatus;
}

export interface CreatePortfolioInput {
  name: string;
  description?: string | null;
  folderId?: string | null;
  ownerId?: string | null;
  scoringModelId?: string | null;
  status?: LifecycleStatus;
}
export type UpdatePortfolioInput = Partial<CreatePortfolioInput>;

export interface Program {
  id: string;
  workspaceId: string;
  portfolioId: string | null;
  name: string;
  description: string | null;
  ownerId: string | null;
  status: LifecycleStatus;
  startDate: string | null;
  endDate: string | null;
}

export interface CreateProgramInput {
  name: string;
  description?: string | null;
  portfolioId?: string | null;
  ownerId?: string | null;
  status?: LifecycleStatus;
  startDate?: string | null;
  endDate?: string | null;
}
export type UpdateProgramInput = Partial<CreateProgramInput>;

export interface ScoringCriterion {
  key: string;
  label: string;
  weight: number;
  scaleMin: number;
  scaleMax: number;
  higherIsBetter: boolean;
}

export type ScoringMethod = 'weighted' | 'wsjf';

export interface ScoringModel {
  id: string;
  name: string;
  description: string | null;
  method: ScoringMethod;
  criteria: ScoringCriterion[];
  isDefault: boolean;
}

export interface CreateScoringModelInput {
  name: string;
  description?: string | null;
  method?: ScoringMethod;
  criteria: ScoringCriterion[];
  isDefault?: boolean;
}
export type UpdateScoringModelInput = Partial<CreateScoringModelInput>;

export interface Score {
  id: string;
  scoringModelId: string;
  boardId: string;
  criteriaScores: Record<string, number>;
  totalScore: string;
  scoredBy: string | null;
  scoredAt: string;
  rationale: string | null;
}

export interface SetScoreInput {
  scoringModelId: string;
  criteriaScores: Record<string, number>;
  rationale?: string | null;
}

export type EffortValueQuadrant = 'quick_win' | 'major_project' | 'fill_in' | 'thankless_task';

export interface ValueEffortPoint {
  boardId: string;
  boardName: string;
  value: number;
  effort: number;
  quadrant: EffortValueQuadrant;
}

export interface RankingEntry {
  boardId: string;
  boardName: string;
  score: number;
}

export interface RollupResult {
  boardCount: number;
  startDate: string | null;
  endDate: string | null;
  percentComplete: number;
  plannedCost: number;
  actualCost: number;
  forecastCost: number;
  ustTotal: number;
  openRisks: number;
  criticalRisks: number;
  overall: HealthStatus;
}

export type PortfolioWhatIfAction = 'include' | 'exclude' | 'delay';

export interface PortfolioWhatIfChange {
  boardId: string;
  action: PortfolioWhatIfAction;
  delayDays?: number;
}

export interface PortfolioWhatIfSummary {
  activeProjects: number;
  totalPlannedCost: number;
  latestEndDate: string | null;
}

export interface PortfolioWhatIfResponse {
  baseline: PortfolioWhatIfSummary;
  simulated: PortfolioWhatIfSummary;
}

// ------------------------------------------------------------------------------ governança ---

export type GateStatus = 'pending' | 'approved' | 'rejected' | 'skipped';

export interface StageGateCriterion {
  label: string;
  met: boolean;
}

export interface StageGate {
  id: string;
  boardId: string;
  name: string;
  position: string;
  status: GateStatus;
  dueDate: string | null;
  criteria: StageGateCriterion[];
  decidedBy: string | null;
  decidedAt: string | null;
  notes: string | null;
}

export type RiskStatus = 'open' | 'mitigating' | 'occurred' | 'closed';
export type RiskStrategy = 'avoid' | 'mitigate' | 'transfer' | 'accept';

export interface Risk {
  id: string;
  boardId: string;
  itemId: string | null;
  title: string;
  description: string | null;
  category: string | null;
  probability: number;
  impact: number;
  status: RiskStatus;
  strategy: RiskStrategy | null;
  mitigationPlan: string | null;
  contingencyPlan: string | null;
  ownerId: string | null;
  dueDate: string | null;
  closedAt: string | null;
}

export type IssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface GovernanceIssue {
  id: string;
  boardId: string;
  itemId: string | null;
  riskId: string | null;
  title: string;
  description: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  ownerId: string | null;
  dueDate: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

export type BudgetCategory = 'capex' | 'opex';

export interface PortfolioBudget {
  id: string;
  boardId: string | null;
  programId: string | null;
  portfolioId: string | null;
  name: string;
  category: BudgetCategory;
  currency: string;
  plannedAmount: string;
  fiscalYear: number | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export type CostEntryKind = 'planned' | 'actual' | 'forecast';
export type CostEntrySource = 'manual' | 'timesheet' | 'invoice' | 'import';

export interface CostEntry {
  id: string;
  budgetId: string;
  boardId: string | null;
  itemId: string | null;
  entryDate: string;
  amount: string;
  currency: string;
  kind: CostEntryKind;
  source: CostEntrySource;
  category: string | null;
  description: string | null;
  reference: string | null;
}

export type HealthRuleDimension = 'overall' | 'schedule' | 'cost' | 'scope' | 'quality' | 'risk';
export type HealthRuleMetric =
  | 'spi'
  | 'cpi'
  | 'overdue_items_pct'
  | 'open_critical_risks'
  | 'budget_variance_pct';
export type HealthRuleOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

export interface HealthRule {
  dimension: HealthRuleDimension;
  metric: HealthRuleMetric;
  operator: HealthRuleOperator;
  threshold: number;
  result: HealthStatus;
}

export interface HealthRuleSet {
  id: string;
  boardId: string | null;
  rules: HealthRule[];
}

export interface BoardStatusReport {
  boardId: string;
  boardName: string;
  health: { latest: ProjectHealthEntry | null; history: ProjectHealthEntry[] };
  percentComplete: number;
  evm: { pv: number; ev: number; ac: number; spi: number | null; cpi: number | null; eac: number; vac: number };
  budget: { plannedAmount: number; actualAmount: number; forecastAmount: number };
  openRisks: Risk[];
  openIssues: GovernanceIssue[];
  stageGates: StageGate[];
}

// --------------------------------------------------------------------- contratos/OS/UST (ADR 0054) ---

export type ContractStatus = 'draft' | 'active' | 'suspended' | 'closed';
export type ContractAlertType = 'low_balance' | 'expiring' | 'service_order_stalled';
export type AlertSeverity = 'warning' | 'critical';

export interface ContractAlert {
  type: ContractAlertType;
  severity: AlertSeverity;
  message: string;
}

export interface ContractBalance {
  ustContracted: number;
  ustConsumed: number;
  ustBalance: number;
  percentConsumed: number;
}

export interface StalledOrderAlert {
  serviceOrderId: string;
  number: string;
  alert: ContractAlert;
}

export interface Contract {
  id: string;
  workspaceId: string;
  number: string;
  title: string;
  clientName: string;
  clientDocument: string | null;
  object: string | null;
  seiProcess: string | null;
  biddingReference: string | null;
  startDate: string;
  endDate: string;
  ustUnitPrice: string;
  ustContracted: string;
  totalValue: string;
  status: ContractStatus;
  managerId: string | null;
  notes: string | null;
  /** Calculado ao vivo pelo backend em cada leitura — nunca recalcular no cliente. */
  balance: ContractBalance;
  alerts: ContractAlert[];
  stalledOrders: StalledOrderAlert[];
}

export interface CreateContractInput {
  number: string;
  title: string;
  clientName: string;
  clientDocument?: string | null;
  object?: string | null;
  seiProcess?: string | null;
  biddingReference?: string | null;
  startDate: string;
  endDate: string;
  ustUnitPrice: string;
  ustContracted: string;
  totalValue: string;
  status?: ContractStatus;
  managerId?: string | null;
  notes?: string | null;
}
export type UpdateContractInput = Partial<CreateContractInput>;

export interface CatalogItem {
  id: string;
  contractId: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  defaultUst: string;
  unit: string;
  isActive: boolean;
  sortOrder: number;
}

export interface CreateCatalogItemInput {
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  defaultUst: string;
  unit?: string;
  isActive?: boolean;
  sortOrder?: number;
}
export type UpdateCatalogItemInput = Partial<Omit<CreateCatalogItemInput, 'code'>>;

export type MeasurementStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface Measurement {
  id: string;
  contractId: string;
  periodStart: string;
  periodEnd: string;
  /** Sempre a soma das OS aceitas do período — nunca digitado à mão. */
  measuredUst: string;
  glosaUst: string;
  approvedUst: string | null;
  amount: string | null;
  status: MeasurementStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
}

export interface GenerateMeasurementInput {
  periodStart: string;
  periodEnd: string;
}
export interface UpdateMeasurementInput {
  glosaUst?: string;
  notes?: string | null;
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export interface Invoice {
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
  dueDate?: string | null;
  nfeKey?: string | null;
}
export interface UpdateInvoiceInput {
  dueDate?: string | null;
  nfeKey?: string | null;
}

export type ServiceOrderStatus =
  | 'draft'
  | 'requested'
  | 'issued'
  | 'in_progress'
  | 'delivered'
  | 'accepted'
  | 'measured'
  | 'invoiced'
  | 'cancelled';

export interface ServiceOrderItem {
  id: string;
  serviceOrderId: string;
  catalogItemId: string;
  catalogItemCode: string;
  catalogItemName: string;
  quantity: string;
  ustUnit: string;
  ustTotal: string;
  description: string | null;
  ustOverrideReason: string | null;
}

export interface ServiceOrder {
  id: string;
  contractId: string;
  /** `null` quando a OS é vinculada só ao item (nunca é o caso hoje: item sempre pertence a um board). */
  boardId: string | null;
  /** `null` para uma OS avulsa (sem item), criada direto no board. */
  itemId: string | null;
  number: string;
  seiProcess: string | null;
  description: string | null;
  status: ServiceOrderStatus;
  requestedAt: string | null;
  issuedAt: string | null;
  startDate: string | null;
  plannedEndDate: string | null;
  deliveredAt: string | null;
  acceptedAt: string | null;
  billedAt: string | null;
  /** Sempre a soma das linhas — nunca editável à mão. */
  totalUst: string;
  requesterName: string | null;
  items: ServiceOrderItem[];
}

export interface CreateServiceOrderInput {
  number: string;
  seiProcess?: string | null;
  description?: string | null;
  requesterName?: string | null;
}

export interface UpdateServiceOrderInput {
  description?: string | null;
  seiProcess?: string | null;
  requesterName?: string | null;
  startDate?: string | null;
  plannedEndDate?: string | null;
}

export interface CreateServiceOrderItemInput {
  catalogItemId: string;
  quantity: string;
  /** Omitido = usa o `defaultUst` do catálogo; diferente dele exige `ustOverrideReason`. */
  ustUnit?: string;
  ustOverrideReason?: string;
  description?: string | null;
}

export interface UpdateServiceOrderItemInput {
  quantity?: string;
  ustUnit?: string;
  ustOverrideReason?: string;
  description?: string | null;
}
