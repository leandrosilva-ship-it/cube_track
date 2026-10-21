/** Tipos das respostas da API REST v1 consumidas pela interface (contrato em docs/openapi.json). */

import type { FilterGroup, ViewGroupBy, ViewSortTerm } from '@cube-track/shared';

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
  values: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  version: number;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  replannedStartDate: string | null;
  replannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  progress: string | null;
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
