import { newId } from '@cube-track/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  membershipKind,
  membershipStatus,
  principalType,
  resourceType,
  roleScope,
  userStatus,
} from './_enums.js';
import { deletedAt, tenantFk, tenantTable } from './_helpers.js';

/**
 * Usuário — identidade GLOBAL (um usuário pode pertencer a vários tenants, premissa P2).
 * RLS: visível se for o próprio usuário ou se tiver membership no tenant corrente.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`app.uuid_v7()`)
      .$defaultFn(newId),
    email: text('email').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    locale: text('locale').notNull().default('pt-BR'),
    timezone: text('timezone').notNull().default('America/Sao_Paulo'),
    status: userStatus('status').notNull().default('active'),
    identityProvider: text('identity_provider'),
    externalSubject: text('external_subject'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(sql`lower(${t.email})`),
    uniqueIndex('users_external_subject_key')
      .on(t.identityProvider, t.externalSubject)
      .where(sql`${t.externalSubject} is not null`),
  ],
);

/**
 * Catálogo GLOBAL de permissões (somente leitura para a aplicação).
 * Ex.: `board.create`, `item.update`, `column.manage`, `contract.measure`.
 */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  scope: roleScope('scope').notNull(),
  module: text('module').notNull().default('core'),
  description: text('description').notNull(),
});

/** Papel configurável por tenant (Owner, Admin, Member, Viewer, Guest + papéis customizados). */
export const roles = tenantTable(
  'roles',
  {
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    scope: roleScope('scope').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('roles_tenant_key_key').on(t.tenantId, t.scope, t.key)],
);

/** Permissões concedidas a um papel. */
export const rolePermissions = tenantTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [
    tenantFk('role_permissions', t.tenantId, t.roleId, roles),
    uniqueIndex('role_permissions_role_permission_key').on(t.roleId, t.permissionKey),
  ],
);

/** Vínculo usuário × tenant, com papel de tenant e tipo (membro ou convidado externo). */
export const memberships = tenantTable(
  'memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id').notNull(),
    kind: membershipKind('kind').notNull().default('member'),
    status: membershipStatus('status').notNull().default('active'),
    jobTitle: text('job_title'),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    deletedAt: deletedAt(),
  },
  (t) => [
    tenantFk('memberships', t.tenantId, t.roleId, roles, 'restrict'),
    uniqueIndex('memberships_tenant_user_key').on(t.tenantId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

export const teams = tenantTable(
  'teams',
  {
    name: text('name').notNull(),
    description: text('description'),
    avatarUrl: text('avatar_url'),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('teams_tenant_name_key')
      .on(t.tenantId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const teamMembers = tenantTable(
  'team_members',
  {
    teamId: uuid('team_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isLead: boolean('is_lead').notNull().default(false),
  },
  (t) => [
    tenantFk('team_members', t.tenantId, t.teamId, teams),
    uniqueIndex('team_members_team_user_key').on(t.teamId, t.userId),
    index('team_members_user_idx').on(t.tenantId, t.userId),
  ],
);

/**
 * Concessão de acesso a um recurso (workspace, pasta, portfólio, programa, board, dashboard)
 * para um usuário ou time, com um papel do escopo correspondente.
 */
export const accessGrants = tenantTable(
  'access_grants',
  {
    resourceType: resourceType('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    principalType: principalType('principal_type').notNull(),
    principalId: uuid('principal_id').notNull(),
    roleId: uuid('role_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    tenantFk('access_grants', t.tenantId, t.roleId, roles),
    uniqueIndex('access_grants_resource_principal_key').on(
      t.tenantId,
      t.resourceType,
      t.resourceId,
      t.principalType,
      t.principalId,
    ),
    index('access_grants_principal_idx').on(t.tenantId, t.principalType, t.principalId),
  ],
);

/** Convite para o tenant (opcionalmente já com acesso a um recurso). O token é guardado como hash. */
export const invitations = tenantTable(
  'invitations',
  {
    email: text('email').notNull(),
    roleId: uuid('role_id').notNull(),
    kind: membershipKind('kind').notNull().default('member'),
    resourceType: resourceType('resource_type'),
    resourceId: uuid('resource_id'),
    resourceRoleId: uuid('resource_role_id'),
    tokenHash: text('token_hash').notNull(),
    message: text('message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedUserId: uuid('accepted_user_id').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    tenantFk('invitations', t.tenantId, t.roleId, roles),
    tenantFk('invitations', t.tenantId, t.resourceRoleId, roles, 'set null'),
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    index('invitations_tenant_email_idx').on(t.tenantId, sql`lower(${t.email})`),
  ],
);

/** Sessão autenticada (refresh token rotativo, guardado como hash). */
export const sessions = tenantTable(
  'sessions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    uniqueIndex('sessions_refresh_token_hash_key').on(t.refreshTokenHash),
    index('sessions_user_active_idx')
      .on(t.tenantId, t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Token de API pessoal/integração. Exibido uma única vez; guardamos prefixo + hash. */
export const apiTokens = tenantTable(
  'api_tokens',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: inet('last_used_ip'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    uniqueIndex('api_tokens_token_hash_key').on(t.tokenHash),
    index('api_tokens_user_idx').on(t.tenantId, t.userId),
    check('api_tokens_prefix_len', sql`char_length(${t.tokenPrefix}) between 4 and 16`),
  ],
);
