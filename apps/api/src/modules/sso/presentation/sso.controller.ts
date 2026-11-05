import { Controller, Get, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import {
  setRefreshCookie,
} from '../../identity/presentation/cookies.js';
import { SamlService } from '../application/saml.service.js';
import { SsoConfigService } from '../application/sso-config.service.js';
import * as S from './schemas.js';
import { Inject } from '@nestjs/common';

/**
 * SSO SAML 2.0 (ADR 0057). As rotas `:tenantSlug/*` são PÚBLICAS (precedem a sessão — é como o
 * usuário faz login) e precisam vir ANTES de qualquer rota com segmento dinâmico conflitante; `config`
 * é declarada primeiro na classe para que o Express a resolva antes de `:tenantSlug`.
 */
@Controller('sso')
export class SsoController {
  constructor(
    private readonly config: SsoConfigService,
    private readonly saml: SamlService,
    @Inject(APP_CONFIG) private readonly appConfig: AppConfig,
  ) {}

  @Get('config')
  @Endpoint({
    summary: 'Obter a configuração de SSO SAML 2.0 da organização',
    description: 'Requer `sso.manage`. Nunca devolve o certificado em texto puro (`hasCertificate`).',
    tags: ['sso'],
    response: S.SsoConfigDtoSchema,
  })
  getConfig(@CurrentPrincipal() user: AuthPrincipal) {
    return this.config.get(user);
  }

  @Put('config')
  @Audited({ action: 'sso_config.update', entityType: 'sso_configuration' })
  @Endpoint({
    summary: 'Configurar o SSO SAML 2.0 da organização',
    description: 'Requer `sso.manage`. O certificado do IdP é cifrado antes de salvar.',
    tags: ['sso'],
    body: S.UpdateSsoConfigBody,
    response: S.SsoConfigDtoSchema,
  })
  updateConfig(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.UpdateSsoConfigBody>,
  ) {
    return this.config.update(user, {
      isEnabled: body.isEnabled ?? false,
      idpEntityId: body.idpEntityId,
      idpSsoUrl: body.idpSsoUrl,
      idpSloUrl: body.idpSloUrl ?? null,
      idpCertificate: body.idpCertificate,
      metadataUrl: body.metadataUrl ?? null,
      attributeMapping: {
        email: body.attributeMapping?.email ?? 'email',
        name: body.attributeMapping?.name ?? 'name',
        orgUnit: body.attributeMapping?.orgUnit ?? null,
      },
      provisionOnFirstLogin: body.provisionOnFirstLogin ?? true,
      defaultRoleKey: body.defaultRoleKey ?? 'guest',
    });
  }

  @Get(':tenantSlug/metadata')
  @Endpoint({
    summary: 'Metadados do Service Provider (SP) SAML 2.0 do tenant',
    tags: ['sso'],
    public: true,
    params: S.TenantSlugParams,
  })
  async metadata(
    @Input('params') params: z.infer<typeof S.TenantSlugParams>,
    @Res() response: Response,
  ) {
    const xml = await this.saml.metadata(params.tenantSlug);
    response.type('application/samlmetadata+xml').send(xml);
  }

  @Get(':tenantSlug/login')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip', bucket: 'sso' })
  @Endpoint({
    summary: 'Iniciar login SSO SAML (redireciona ao IdP)',
    tags: ['sso'],
    public: true,
    params: S.TenantSlugParams,
    errors: [302],
  })
  async login(
    @Input('params') params: z.infer<typeof S.TenantSlugParams>,
    @Res() response: Response,
  ) {
    const url = await this.saml.loginRedirectUrl(params.tenantSlug);
    response.redirect(302, url);
  }

  @Post(':tenantSlug/acs')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip', bucket: 'sso' })
  @Audited({ action: 'auth.saml_login', entityType: 'session', transactional: false })
  @Endpoint({
    summary: 'Assertion Consumer Service (ACS) — recebe a resposta SAML assinada do IdP',
    description:
      'Em sucesso, grava o refresh cookie e redireciona para `${APP_URL}/auth/callback`; com MFA, para `/auth/mfa?challenge=`.',
    tags: ['sso'],
    public: true,
    params: S.TenantSlugParams,
    body: S.AcsBody,
    errors: [302],
  })
  async acs(
    @Input('params') params: z.infer<typeof S.TenantSlugParams>,
    @Input('body') body: z.infer<typeof S.AcsBody>,
    @Res() response: Response,
  ) {
    const fail = (code: string) => {
      response.redirect(302, `${this.appConfig.APP_URL}/auth/callback?error=${encodeURIComponent(code)}`);
    };
    try {
      const result = await this.saml.handleAcs(params.tenantSlug, body);
      if (result.kind === 'mfa') {
        response.redirect(
          302,
          `${this.appConfig.APP_URL}/auth/mfa?challenge=${encodeURIComponent(result.challengeToken)}`,
        );
        return;
      }
      setRefreshCookie(response, this.appConfig, result.session);
      response.redirect(302, `${this.appConfig.APP_URL}/auth/callback?status=ok`);
    } catch (error) {
      fail(
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'saml_failed',
      );
    }
  }
}
