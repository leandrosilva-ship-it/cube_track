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
  | 'project_health';

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
      history: { id: string; reportedAt: string; overall: HealthStatus }[];
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
