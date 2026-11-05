import { Inject, Injectable } from '@nestjs/common';
import { SAML, ValidateInResponseTo, generateServiceProviderMetadata } from '@node-saml/node-saml';
import type { SamlAttributeMapping } from '@cube-track/shared';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { TenantResolver } from '../../../core/tenancy/tenant-resolver.service.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../../core/errors/problems.js';
import { AuthService, type LoginResult } from '../../identity/application/auth.service.js';
import { SsoConfigService } from './sso-config.service.js';
import type { SsoConfigRow } from '../infrastructure/sso-config.repository.js';

/**
 * Service Provider SAML 2.0 (ADR 0057). Usa `@node-saml/node-saml` para a verificação de assinatura
 * XML-DSig da asserção do IdP (canonicalização C14N, `xml-crypto`) — não reimplementada aqui.
 *
 * Decisões documentadas na ADR: `validateInResponseTo: 'never'` (sem cache persistente de
 * AuthnRequest entre instâncias da API — aceita IdP-initiated e SP-initiated sem proteção extra de
 * replay além do `maxAssertionAgeMs`/`acceptedClockSkewMs` padrão da biblioteca); SP não assina as
 * próprias AuthnRequests (sem chave privada própria configurável nesta entrega — `wantAssertionsSigned:
 * true` continua obrigatório na direção IdP → SP, que é a que importa para autenticação).
 */
@Injectable()
export class SamlService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly tenants: TenantResolver,
    private readonly config: SsoConfigService,
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {}

  private spEntityId(tenantSlug: string): string {
    return `${this.appConfig.API_URL}/v1/sso/${tenantSlug}/metadata`;
  }

  private acsUrl(tenantSlug: string): string {
    return `${this.appConfig.API_URL}/v1/sso/${tenantSlug}/acs`;
  }

  async metadata(tenantSlug: string): Promise<string> {
    await this.loadEnabledConfig(tenantSlug);
    return generateServiceProviderMetadata({
      issuer: this.spEntityId(tenantSlug),
      callbackUrl: this.acsUrl(tenantSlug),
      wantAssertionsSigned: true,
      decryptionCert: null,
    });
  }

  async loginRedirectUrl(tenantSlug: string): Promise<string> {
    const { row } = await this.loadEnabledConfig(tenantSlug);
    const saml = this.buildClient(tenantSlug, row);
    return saml.getAuthorizeUrlAsync('', {});
  }

  async handleAcs(
    tenantSlug: string,
    body: { SAMLResponse: string; RelayState?: string | undefined },
  ): Promise<LoginResult> {
    const { tenantId, row } = await this.loadEnabledConfig(tenantSlug);
    const saml = this.buildClient(tenantSlug, row);
    const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: body.SAMLResponse });
    if (profile === null) throw new UnauthorizedError('saml_invalid', 'Resposta SAML inválida.');
    const mapping = row.attributeMapping as SamlAttributeMapping;
    const email = (profile[mapping.email] as string | undefined) ?? profile.email ?? profile.mail;
    if (typeof email !== 'string' || email.trim() === '') {
      throw new UnauthorizedError(
        'saml_missing_email',
        'A asserção do provedor de identidade não trouxe um e-mail.',
      );
    }
    const name = (profile[mapping.name] as string | undefined) ?? email;
    const orgUnit =
      mapping.orgUnit === null ? null : ((profile[mapping.orgUnit] as string | undefined) ?? null);
    return this.auth.completeSaml(
      tenantId,
      { email, name, orgUnit, nameId: profile.nameID },
      { provisionOnFirstLogin: row.provisionOnFirstLogin, defaultRoleKey: row.defaultRoleKey },
    );
  }

  private async loadEnabledConfig(
    tenantSlug: string,
  ): Promise<{ tenantId: string; row: SsoConfigRow }> {
    const tenant = await this.tenants.resolve(tenantSlug, 'header');
    const row = await this.runner.run(
      { tenantId: tenant.tenantId, userId: null },
      () => this.config.internalConfig(tenant.tenantId),
      { readOnly: true },
    );
    if (row?.isEnabled !== true) {
      throw new NotFoundError('Configuração de SSO', 'sso_not_configured');
    }
    return { tenantId: tenant.tenantId, row };
  }

  private buildClient(tenantSlug: string, row: SsoConfigRow): SAML {
    if (!row.isEnabled) throw new ForbiddenError('SSO desabilitado para esta organização.', 'sso_disabled');
    return new SAML({
      idpCert: this.config.decryptCertificate(row),
      issuer: this.spEntityId(tenantSlug),
      callbackUrl: this.acsUrl(tenantSlug),
      entryPoint: row.idpSsoUrl,
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.never,
      disableRequestedAuthnContext: true,
      audience: this.spEntityId(tenantSlug),
    });
  }
}
