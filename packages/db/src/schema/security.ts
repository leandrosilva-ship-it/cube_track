import { boolean, index, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { consentPurpose, dataSubjectRequestKind, dataSubjectRequestStatus } from './_enums.js';
import { appendOnlyColumns, tenantTable } from './_helpers.js';
import { users } from './identity.js';

/**
 * Segurança avançada (Prompt 16, ADR 0057): SSO SAML 2.0, políticas de senha/sessão/IP e LGPD
 * (consentimento, portabilidade/exclusão). `dataRetentionPolicies` já existia desde o Prompt 2
 * (`governance.ts`) e é reaproveitada tal como está — nada duplicado aqui.
 */

/** Configuração de SSO SAML 2.0 do tenant — uma linha por tenant (ADR 0057). O certificado do IdP é
 * cifrado (AES-256-GCM, `@cube-track/shared/crypto`, mesmo padrão BYOK de `ai_settings`/
 * `integration_connections`) — nunca armazenado nem exposto em texto puro pela API. */
export const ssoConfigurations = tenantTable(
  'sso_configurations',
  {
    isEnabled: boolean('is_enabled').notNull().default(false),
    idpEntityId: text('idp_entity_id').notNull(),
    idpSsoUrl: text('idp_sso_url').notNull(),
    idpSloUrl: text('idp_slo_url'),
    idpCertificateCiphertext: text('idp_certificate_ciphertext').notNull(),
    metadataUrl: text('metadata_url'),
    /** `SamlAttributeMapping` (`@cube-track/shared/security`). */
    attributeMapping: jsonb('attribute_mapping').$type<Record<string, unknown>>().notNull().default({}),
    provisionOnFirstLogin: boolean('provision_on_first_login').notNull().default(true),
    defaultRoleKey: text('default_role_key').notNull().default('guest'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('sso_configurations_tenant_key').on(t.tenantId)],
);

/** Política de segurança do tenant (senha, sessão, allowlist de IP/domínio) — uma linha por tenant.
 * Sub-formas validadas por Zod na borda da API (`@cube-track/shared/security`); ausência de chave =
 * usa o padrão (`DEFAULT_PASSWORD_POLICY` etc.), nunca interpretado como "sem política". */
export const securityPolicies = tenantTable(
  'security_policies',
  {
    /** `PasswordPolicy`. */
    passwordPolicy: jsonb('password_policy').$type<Record<string, unknown>>().notNull().default({}),
    /** `SessionPolicy`. */
    sessionPolicy: jsonb('session_policy').$type<Record<string, unknown>>().notNull().default({}),
    /** `AccessRestrictionPolicy` (CIDRs + domínios de e-mail permitidos). */
    accessRestriction: jsonb('access_restriction')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('security_policies_tenant_key').on(t.tenantId)],
);

/** Registro de consentimento LGPD — append-only (uma linha por mudança de decisão, nunca atualizada). */
export const consentRecords = tenantTable(
  'consent_records',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: consentPurpose('purpose').notNull(),
    granted: boolean('granted').notNull(),
    policyVersion: text('policy_version').notNull(),
  },
  (t) => [index('consent_records_tenant_user_idx').on(t.tenantId, t.userId, t.createdAt)],
  appendOnlyColumns(),
);

/** Solicitação de titular LGPD (exportação ou exclusão/anonimização) — fluxo de status
 * `requested → approved → executed` (ou `rejected`). */
export const dataSubjectRequests = tenantTable(
  'data_subject_requests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: dataSubjectRequestKind('kind').notNull(),
    status: dataSubjectRequestStatus('status').notNull().default('requested'),
    reason: text('reason'),
    decisionNote: text('decision_note'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    /** Chave do objeto no S3/MinIO do export gerado (`kind = 'export'`, `status = 'executed'`). */
    exportStorageKey: text('export_storage_key'),
  },
  (t) => [index('data_subject_requests_tenant_user_idx').on(t.tenantId, t.userId, t.createdAt)],
);
