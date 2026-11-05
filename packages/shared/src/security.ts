import { z } from 'zod';

/**
 * Segurança avançada (Prompt 16, ADR 0057): SSO SAML 2.0, SCIM, políticas de senha/sessão,
 * allowlist de IP/domínio, LGPD (consentimento, portabilidade/exclusão) e busca/exportação de
 * auditoria. Schemas puros (Zod) reutilizados pela API e pelo front — nenhuma dependência de
 * `node:crypto` aqui (cifra de segredos usa `@cube-track/shared/crypto`, já fora do barrel principal).
 */

// ------------------------------------------------------------------------------------- SSO SAML ---

/** Mapeamento de atributos da asserção SAML para os campos do usuário CUBE TRACK. */
export const SamlAttributeMappingSchema = z
  .object({
    email: z.string().min(1).default('email'),
    name: z.string().min(1).default('name'),
    /** Atributo opcional usado para resolver `org_unit` do convidado (item 1, visibilidade por órgão). */
    orgUnit: z.string().min(1).nullable().default(null),
  })
  .strict();
export type SamlAttributeMapping = z.infer<typeof SamlAttributeMappingSchema>;

/** Configuração do Identity Provider — ou a URL dos metadados, ou o XML cru (um dos dois). */
export const SamlConfigSchema = z
  .object({
    isEnabled: z.boolean().default(false),
    /** Identificador da entidade do IdP (`entityID` no XML de metadados). */
    idpEntityId: z.string().min(1).max(2_000),
    /** Endpoint de SSO do IdP (`HTTP-Redirect`/`HTTP-POST`). */
    idpSsoUrl: z.url(),
    /** Endpoint opcional de logout único (`SLO`) do IdP. */
    idpSloUrl: z.url().nullable().default(null),
    /** Certificado x509 do IdP em PEM (sem o cabeçalho/rodapé é aceito e normalizado). */
    idpCertificate: z.string().min(1),
    /** URL dos metadados do IdP, se a configuração foi importada por URL (somente informativo). */
    metadataUrl: z.url().nullable().default(null),
    attributeMapping: SamlAttributeMappingSchema.default({
      email: 'email',
      name: 'name',
      orgUnit: null,
    }),
    /** Provisiona automaticamente um usuário novo (papel `guest` como padrão seguro) no primeiro
     * login via SSO; se `false`, exige convite prévio (o e-mail da asserção deve já existir). */
    provisionOnFirstLogin: z.boolean().default(true),
    defaultRoleKey: z.string().min(1).max(64).default('guest'),
  })
  .strict();
export type SamlConfig = z.infer<typeof SamlConfigSchema>;

/** Entrada de criação/atualização — aceita o certificado em texto puro; a API cifra antes de salvar. */
export const UpsertSamlConfigSchema = SamlConfigSchema;
export type UpsertSamlConfig = z.infer<typeof UpsertSamlConfigSchema>;

// ------------------------------------------------------------------------------------- SCIM 2.0 ---

export const SCIM_SCHEMAS = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  group: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  listResponse: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  error: 'urn:ietf:params:scim:api:messages:2.0:Error',
  patchOp: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
} as const;

const scimMeta = z.object({
  resourceType: z.enum(['User', 'Group']),
  created: z.iso.datetime().optional(),
  lastModified: z.iso.datetime().optional(),
  location: z.string().optional(),
});

/** Recurso `User` do SCIM 2.0 — só os campos que o provisionamento CUBE TRACK usa. */
export const ScimUserSchema = z.object({
  schemas: z.array(z.string()).default([SCIM_SCHEMAS.user]),
  id: z.string().optional(),
  externalId: z.string().optional(),
  userName: z.string().min(1),
  name: z
    .object({ formatted: z.string().optional(), givenName: z.string().optional(), familyName: z.string().optional() })
    .optional(),
  displayName: z.string().optional(),
  emails: z
    .array(z.object({ value: z.email(), primary: z.boolean().optional(), type: z.string().optional() }))
    .min(1),
  active: z.boolean().default(true),
  /** Extensão de empresa padrão do SCIM — usada para popular `org_unit` (item 1). */
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': z
    .object({ department: z.string().optional() })
    .optional(),
  meta: scimMeta.optional(),
});
export type ScimUser = z.infer<typeof ScimUserSchema>;

export const ScimGroupSchema = z.object({
  schemas: z.array(z.string()).default([SCIM_SCHEMAS.group]),
  id: z.string().optional(),
  displayName: z.string().min(1),
  members: z.array(z.object({ value: z.string(), display: z.string().optional() })).default([]),
  meta: scimMeta.optional(),
});
export type ScimGroup = z.infer<typeof ScimGroupSchema>;

export const ScimPatchOperationSchema = z.object({
  schemas: z.array(z.literal(SCIM_SCHEMAS.patchOp)),
  Operations: z
    .array(
      z.object({
        op: z.enum(['add', 'remove', 'replace']),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1),
});
export type ScimPatchOperation = z.infer<typeof ScimPatchOperationSchema>;

export function scimListResponse<T>(resources: readonly T[], totalResults: number, startIndex: number) {
  return {
    schemas: [SCIM_SCHEMAS.listResponse],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function scimError(status: number, detail: string) {
  return { schemas: [SCIM_SCHEMAS.error], status: String(status), detail };
}

// -------------------------------------------------------------------------- política de senha ---

export const PasswordPolicySchema = z
  .object({
    minLength: z.number().int().min(8).max(128).default(10),
    requireUppercase: z.boolean().default(true),
    requireLowercase: z.boolean().default(true),
    requireDigit: z.boolean().default(true),
    requireSymbol: z.boolean().default(false),
    /** `null` = sem expiração forçada. */
    maxAgeDays: z.number().int().min(1).max(3_650).nullable().default(null),
    /** Quantas senhas anteriores não podem ser reutilizadas (0 = não verifica histórico). */
    historyCount: z.number().int().min(0).max(24).default(5),
  })
  .strict();
export type PasswordPolicy = z.infer<typeof PasswordPolicySchema>;

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = PasswordPolicySchema.parse({});

/** Valida uma senha em texto puro contra a política — usado em troca/definição de senha. */
export function checkPasswordPolicy(password: string, policy: PasswordPolicy): string[] {
  const violations: string[] = [];
  if (password.length < policy.minLength) violations.push('min_length');
  if (policy.requireUppercase && !/[A-ZÀ-Ý]/.test(password)) violations.push('uppercase');
  if (policy.requireLowercase && !/[a-zà-ÿ]/.test(password)) violations.push('lowercase');
  if (policy.requireDigit && !/\d/.test(password)) violations.push('digit');
  if (policy.requireSymbol && !/[^\dA-Za-zÀ-ÿ]/.test(password)) violations.push('symbol');
  return violations;
}

/** `passwordChangedAt` excedeu `maxAgeDays`? (`null` de política ou de data = nunca expira). */
export function isPasswordExpired(
  passwordChangedAt: Date | null,
  policy: PasswordPolicy,
  now: Date = new Date(),
): boolean {
  if (policy.maxAgeDays === null || passwordChangedAt === null) return false;
  const ageMs = now.getTime() - passwordChangedAt.getTime();
  return ageMs > policy.maxAgeDays * 86_400_000;
}

// -------------------------------------------------------------------------- política de sessão ---

export const SessionPolicySchema = z
  .object({
    idleTimeoutMinutes: z.number().int().min(5).max(43_200).default(480),
    absoluteLifetimeHours: z.number().int().min(1).max(8_760).default(720),
    maxConcurrentSessions: z.number().int().min(1).max(100).default(10),
  })
  .strict();
export type SessionPolicy = z.infer<typeof SessionPolicySchema>;

export const DEFAULT_SESSION_POLICY: SessionPolicy = SessionPolicySchema.parse({});

// ------------------------------------------------------------------- allowlist de IP/domínio ---

/** Um CIDR (`10.0.0.0/8`) ou IP isolado (tratado como `/32` ou `/128`). Validação de formato leve —
 * a validação completa (parsing de octetos) acontece na borda da API com a biblioteca de IP. */
const cidrPattern = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

export const AccessRestrictionPolicySchema = z
  .object({
    isEnabled: z.boolean().default(false),
    /** Login/API só permitido a partir destes CIDRs. Vazio + habilitado = bloqueia tudo (fail-safe). */
    allowedCidrs: z.array(z.string().regex(cidrPattern)).max(200).default([]),
    /** Login só permitido para e-mails destes domínios (ex.: `empresa.gov.br`). */
    allowedEmailDomains: z.array(z.string().toLowerCase().min(1).max(253)).max(200).default([]),
  })
  .strict();
export type AccessRestrictionPolicy = z.infer<typeof AccessRestrictionPolicySchema>;

export const DEFAULT_ACCESS_RESTRICTION_POLICY: AccessRestrictionPolicy =
  AccessRestrictionPolicySchema.parse({});

// Parsing de IP/CIDR em JS puro (sem `node:net`/`node:dns`): este arquivo entra no barrel principal
// (`@cube-track/shared`), e qualquer módulo nativo aqui arrasta o mesmo problema de bundle do cliente
// documentado para `node:crypto` em `crypto.ts`.

function parseIpv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const target = parseIpv4(ip);
  const network = parseIpv4(base ?? '');
  if (target === null || network === null) return false;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~(0xffffffff >>> bits) >>> 0);
  return (target & mask) >>> 0 === (network & mask) >>> 0;
}

/** Expande `::` e valida um endereço IPv6 completo, devolvendo os 128 bits como `bigint`. */
function parseIpv6(ip: string): bigint | null {
  if (!ip.includes(':')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' || halves[0] === undefined ? [] : halves[0].split(':');
  const tail =
    halves.length === 2 && halves[1] !== '' && halves[1] !== undefined ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function ipv6InCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const target = parseIpv6(ip);
  const network = parseIpv6(base ?? '');
  if (target === null || network === null) return false;
  const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 128) return false;
  if (bits === 0) return true;
  const fullMask = (1n << 128n) - 1n;
  const mask = bits === 128 ? fullMask : (fullMask << BigInt(128 - bits)) & fullMask;
  return (target & mask) === (network & mask);
}

/** `ip` cai em algum dos CIDRs/IPs isolados de `allowedCidrs`. Lista vazia nunca permite (fail-safe —
 * o chamador decide separadamente se a lista vazia bloqueia tudo ou é "regra não configurada"). */
export function isIpAllowed(ip: string, allowedCidrs: readonly string[]): boolean {
  return allowedCidrs.some((cidr) =>
    ip.includes(':') ? cidr.includes(':') && ipv6InCidr(ip, cidr) : ipv4InCidr(ip, cidr),
  );
}

/** O domínio do e-mail está entre `allowedEmailDomains` (comparação exata, case-insensitive). */
export function isEmailDomainAllowed(email: string, allowedEmailDomains: readonly string[]): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return domain !== undefined && allowedEmailDomains.includes(domain);
}

export type AccessRestrictionReason = 'ip_not_allowed' | 'domain_not_allowed' | 'no_rules_configured';

/**
 * Decide se um login/requisição pode prosseguir sob a allowlist do tenant. Fail-safe: habilitada SEM
 * nenhuma regra preenchida bloqueia tudo (`no_rules_configured`), nunca libera por omissão. Quando as
 * duas listas estão preenchidas, AMBAS precisam bater (E lógico) — a mais restritiva faz sentido para
 * o caso de referência (órgão público: rede corporativa E domínio institucional).
 */
export function checkAccessRestriction(
  ip: string | null,
  email: string,
  policy: AccessRestrictionPolicy,
): { allowed: boolean; reason: AccessRestrictionReason | null } {
  if (!policy.isEnabled) return { allowed: true, reason: null };
  const hasCidrRule = policy.allowedCidrs.length > 0;
  const hasDomainRule = policy.allowedEmailDomains.length > 0;
  if (!hasCidrRule && !hasDomainRule) return { allowed: false, reason: 'no_rules_configured' };
  if (hasCidrRule && (ip === null || !isIpAllowed(ip, policy.allowedCidrs))) {
    return { allowed: false, reason: 'ip_not_allowed' };
  }
  if (hasDomainRule && !isEmailDomainAllowed(email, policy.allowedEmailDomains)) {
    return { allowed: false, reason: 'domain_not_allowed' };
  }
  return { allowed: true, reason: null };
}

/** Política completa de segurança de um tenant — uma linha por tenant (`security_policies`). */
export const SecurityPolicySchema = z
  .object({
    password: PasswordPolicySchema.default(DEFAULT_PASSWORD_POLICY),
    session: SessionPolicySchema.default(DEFAULT_SESSION_POLICY),
    accessRestriction: AccessRestrictionPolicySchema.default(DEFAULT_ACCESS_RESTRICTION_POLICY),
  })
  .strict();
export type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = SecurityPolicySchema.parse({});

// -------------------------------------------------------------------------------------- LGPD ---

export const CONSENT_PURPOSES = [
  'marketing_email',
  'product_analytics',
  'ai_processing',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Registro de consentimento — append-only (uma linha por mudança de decisão). */
export const ConsentRecordSchema = z
  .object({
    purpose: z.enum(CONSENT_PURPOSES),
    granted: z.boolean(),
    /** Texto/versão da política apresentada no momento do consentimento (trilha de evidência). */
    policyVersion: z.string().min(1).max(64),
  })
  .strict();
export type ConsentRecordInput = z.infer<typeof ConsentRecordSchema>;

export const DATA_SUBJECT_REQUEST_KINDS = ['export', 'erasure'] as const;
export type DataSubjectRequestKind = (typeof DATA_SUBJECT_REQUEST_KINDS)[number];

export const DATA_SUBJECT_REQUEST_STATUSES = [
  'requested',
  'approved',
  'executed',
  'rejected',
] as const;
export type DataSubjectRequestStatus = (typeof DATA_SUBJECT_REQUEST_STATUSES)[number];

export const CreateDataSubjectRequestSchema = z
  .object({
    kind: z.enum(DATA_SUBJECT_REQUEST_KINDS),
    reason: z.string().max(2_000).nullable().default(null),
  })
  .strict();
export type CreateDataSubjectRequest = z.infer<typeof CreateDataSubjectRequestSchema>;

export const DecideDataSubjectRequestSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    decisionNote: z.string().max(2_000).nullable().default(null),
  })
  .strict();
export type DecideDataSubjectRequest = z.infer<typeof DecideDataSubjectRequestSchema>;

// -------------------------------------------------------------------------- auditoria avançada ---

export const AUDIT_ACTOR_KINDS = ['user', 'automation', 'api', 'import', 'system'] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

/** Filtros de busca em `audit_logs` — todos opcionais (combinados com E lógico). */
export const AuditSearchFilterSchema = z
  .object({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    actorId: z.uuid().optional(),
    actorKind: z.enum(AUDIT_ACTOR_KINDS).optional(),
    action: z.string().max(100).optional(),
    entityType: z.string().max(100).optional(),
    entityId: z.uuid().optional(),
    /** Busca textual simples em `action`/`entity_type` (ILIKE). */
    search: z.string().max(200).optional(),
  })
  .strict();
export type AuditSearchFilter = z.infer<typeof AuditSearchFilterSchema>;

export const AuditExportFormatSchema = z.enum(['csv', 'ndjson']);
export type AuditExportFormat = z.infer<typeof AuditExportFormatSchema>;
