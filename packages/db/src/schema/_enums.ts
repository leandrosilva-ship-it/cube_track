import { pgEnum } from 'drizzle-orm/pg-core';

// Identidade e acesso
export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended', 'closed']);
export const userStatus = pgEnum('user_status', ['active', 'invited', 'suspended', 'anonymized']);
export const membershipKind = pgEnum('membership_kind', ['member', 'guest']);
export const membershipStatus = pgEnum('membership_status', ['active', 'invited', 'suspended']);
export const roleScope = pgEnum('role_scope', ['tenant', 'workspace', 'board']);
export const principalType = pgEnum('principal_type', ['user', 'team']);
export const resourceType = pgEnum('resource_type', [
  'workspace',
  'folder',
  'portfolio',
  'program',
  'board',
  'dashboard',
  'view',
  'item',
]);
export const authTokenPurpose = pgEnum('auth_token_purpose', [
  'magic_link',
  'password_reset',
  'email_verification',
]);
export const identityProvider = pgEnum('identity_provider', [
  'google',
  'microsoft',
  'saml',
  'oidc',
]);

// Estrutura
export const workspaceVisibility = pgEnum('workspace_visibility', ['open', 'closed']);
export const folderKind = pgEnum('folder_kind', ['regular', 'templates']);
export const boardKind = pgEnum('board_kind', ['board', 'project', 'process', 'backlog']);
export const boardVisibility = pgEnum('board_visibility', ['main', 'private', 'shareable']);
export const lifecycleStatus = pgEnum('lifecycle_status', [
  'proposed',
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
]);
export const favoriteEntity = pgEnum('favorite_entity', [
  'workspace',
  'folder',
  'board',
  'dashboard',
  'item',
  'portfolio',
  'program',
]);

// Customização e views
export const statusCategory = pgEnum('status_category', [
  'not_started',
  'in_progress',
  'done',
  'stuck',
]);
export const viewType = pgEnum('view_type', [
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
]);
export const shareResource = pgEnum('share_resource', ['board', 'view', 'dashboard', 'form']);

// Colaboração
export const updateTarget = pgEnum('update_target', ['update', 'reply']);
export const mentionTarget = pgEnum('mention_target', ['user', 'team', 'everyone']);
export const mentionSource = pgEnum('mention_source', ['update', 'reply', 'item_description']);
export const actorKind = pgEnum('actor_kind', ['user', 'automation', 'api', 'import', 'system']);
export const scanStatus = pgEnum('scan_status', ['pending', 'clean', 'infected', 'failed']);
export const notificationChannel = pgEnum('notification_channel', ['in_app', 'email', 'push']);
export const notificationFrequency = pgEnum('notification_frequency', [
  'instant',
  'hourly',
  'daily',
  'weekly',
  'never',
]);
export const followEntity = pgEnum('follow_entity', ['board', 'item', 'dashboard']);

// Planejamento
export const dependencyType = pgEnum('dependency_type', ['FS', 'SS', 'FF', 'SF']);
export const sprintState = pgEnum('sprint_state', ['planned', 'active', 'closed']);
export const milestoneStatus = pgEnum('milestone_status', [
  'pending',
  'achieved',
  'missed',
  'cancelled',
]);
export const holidayScope = pgEnum('holiday_scope', ['national', 'state', 'municipal', 'company']);

// Recursos
export const allocationStatus = pgEnum('allocation_status', ['tentative', 'confirmed']);
export const absenceType = pgEnum('absence_type', [
  'vacation',
  'sick_leave',
  'training',
  'day_off',
  'other',
]);
export const approvalStatus = pgEnum('approval_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
]);
export const timeEntrySource = pgEnum('time_entry_source', ['manual', 'timer', 'import', 'api']);
export const resourceRequestStatus = pgEnum('resource_request_status', [
  'open',
  'fulfilled',
  'cancelled',
]);

// Processos
export const phaseKind = pgEnum('phase_kind', ['start', 'intermediate', 'done', 'cancelled']);
export const slaEventType = pgEnum('sla_event_type', [
  'started',
  'paused',
  'resumed',
  'warning',
  'breached',
  'met',
  'stopped',
]);
export const slaTrackerStatus = pgEnum('sla_tracker_status', [
  'running',
  'paused',
  'met',
  'breached',
  'stopped',
]);

// Automação
export const runStatus = pgEnum('run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);
export const deliveryStatus = pgEnum('delivery_status', ['pending', 'succeeded', 'failed', 'dead']);

// Dashboards
export const dashboardVisibility = pgEnum('dashboard_visibility', ['private', 'workspace']);

// Portfólio
export const healthStatus = pgEnum('health_status', ['green', 'yellow', 'red', 'grey']);
export const gateStatus = pgEnum('gate_status', ['pending', 'approved', 'rejected', 'skipped']);
export const riskStatus = pgEnum('risk_status', ['open', 'mitigating', 'occurred', 'closed']);
export const riskStrategy = pgEnum('risk_strategy', ['avoid', 'mitigate', 'transfer', 'accept']);
export const issueSeverity = pgEnum('issue_severity', ['low', 'medium', 'high', 'critical']);
export const issueStatus = pgEnum('issue_status', ['open', 'in_progress', 'resolved', 'closed']);
export const budgetCategory = pgEnum('budget_category', ['capex', 'opex']);
export const costKind = pgEnum('cost_kind', ['planned', 'actual', 'forecast']);
export const costSource = pgEnum('cost_source', ['manual', 'timesheet', 'invoice', 'import']);

// Contratos
export const contractStatus = pgEnum('contract_status', ['draft', 'active', 'suspended', 'closed']);
export const serviceOrderStatus = pgEnum('service_order_status', [
  'draft',
  'requested',
  'issued',
  'in_progress',
  'delivered',
  'accepted',
  'measured',
  'invoiced',
  'cancelled',
]);
export const measurementStatus = pgEnum('measurement_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
]);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'issued', 'paid', 'cancelled']);

// Governança
export const retentionAction = pgEnum('retention_action', ['delete', 'anonymize', 'archive']);
export const templateKind = pgEnum('template_kind', [
  'workspace',
  'board',
  'item',
  'automation',
  'dashboard',
  'form',
]);
