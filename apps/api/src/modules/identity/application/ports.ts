/**
 * Portas de identidade federada empresarial — interfaces estáveis; implementações no Prompt 16
 * (ADR 0026). Nenhuma rota é exposta enquanto não houver adaptador registrado.
 */

/** Asserção SAML 2.0 já validada (assinatura, audiência, validade, InResponseTo). */
export interface SamlAssertion {
  issuer: string;
  nameId: string;
  email: string;
  attributes: Record<string, string[]>;
  sessionIndex: string | null;
}

export interface SamlConnection {
  tenantId: string;
  entityId: string;
  ssoUrl: string;
  certificatePem: string;
  /** Domínios de e-mail verificados que usam esta conexão (ex.: prefeitura.sp.gov.br). */
  domains: string[];
  enforced: boolean;
}

export interface SamlServiceProvider {
  /** URL de redirecionamento (AuthnRequest) para o IdP da organização. */
  buildLoginRequest(
    connection: SamlConnection,
    relayState: string,
  ): Promise<{ redirectUrl: string; requestId: string }>;
  /** Valida a resposta do IdP (POST binding) e retorna a asserção. */
  validateResponse(
    connection: SamlConnection,
    samlResponse: string,
    expectedRequestId: string,
  ): Promise<SamlAssertion>;
  /** Metadados XML do provedor de serviço (SP) para o IdP. */
  metadata(tenantId: string): Promise<string>;
}

export const SAML_SERVICE_PROVIDER = Symbol('SAML_SERVICE_PROVIDER');

/** Recurso SCIM 2.0 (RFC 7643) — subconjunto suportado. */
export interface ScimUser {
  id: string;
  externalId?: string;
  userName: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails: { value: string; primary?: boolean }[];
  active: boolean;
}

export interface ScimGroup {
  id: string;
  externalId?: string;
  displayName: string;
  members: { value: string }[];
}

export interface ScimListResponse<T> {
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  resources: T[];
}

/** Provisionamento SCIM (RFC 7644) por tenant: usuários → memberships; grupos → times. */
export interface ScimProvisioning {
  listUsers(
    tenantId: string,
    filter: string | null,
    startIndex: number,
    count: number,
  ): Promise<ScimListResponse<ScimUser>>;
  getUser(tenantId: string, id: string): Promise<ScimUser | null>;
  createUser(tenantId: string, user: Omit<ScimUser, 'id'>): Promise<ScimUser>;
  replaceUser(tenantId: string, id: string, user: Omit<ScimUser, 'id'>): Promise<ScimUser>;
  /** `active: false` suspende o membership (nunca exclui dados — LGPD/auditoria). */
  patchUser(
    tenantId: string,
    id: string,
    operations: { op: 'add' | 'replace' | 'remove'; path?: string; value?: unknown }[],
  ): Promise<ScimUser>;
  deactivateUser(tenantId: string, id: string): Promise<void>;
  listGroups(
    tenantId: string,
    filter: string | null,
    startIndex: number,
    count: number,
  ): Promise<ScimListResponse<ScimGroup>>;
  createGroup(tenantId: string, group: Omit<ScimGroup, 'id'>): Promise<ScimGroup>;
  patchGroup(
    tenantId: string,
    id: string,
    operations: { op: 'add' | 'replace' | 'remove'; path?: string; value?: unknown }[],
  ): Promise<ScimGroup>;
  deleteGroup(tenantId: string, id: string): Promise<void>;
}

export const SCIM_PROVISIONING = Symbol('SCIM_PROVISIONING');
