/** Tipos das respostas da API REST v1 consumidas pela interface (contrato em docs/openapi.json). */

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

export interface BoardColumn {
  id: string;
  key: string;
  type: string;
  title: string;
  description: string | null;
  binding: string | null;
  isRequired: boolean;
  position: string;
  width: number | null;
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

export interface BoardDetail {
  id: string;
  workspaceId: string;
  folderId: string | null;
  kind: BoardKind;
  name: string;
  description: string | null;
  visibility: BoardVisibility;
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
  archivedAt: string | null;
  redactedFields: string[];
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
