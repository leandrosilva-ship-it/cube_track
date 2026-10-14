import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { z } from 'zod';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { UnauthorizedError, UnprocessableError } from '../../../core/errors/problems.js';

export type OAuthProviderName = 'google' | 'microsoft';

interface ProviderEndpoints {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  /** Valida o `iss` do id_token. */
  issuerMatches: (issuer: string, payload: JWTPayload) => boolean;
  scope: string;
}

export interface OAuthIdentity {
  provider: OAuthProviderName;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

const TokenResponse = z.object({ id_token: z.string(), access_token: z.string().optional() });
const IdTokenClaims = z.object({
  sub: z.string(),
  email: z.string().optional(),
  email_verified: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
  preferred_username: z.string().optional(),
  name: z.string().optional(),
  nonce: z.string().optional(),
  tid: z.string().optional(),
});

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Cliente OIDC (Authorization Code + PKCE) para Google e Microsoft Entra ID.
 * O id_token é validado com a chave pública do provedor (JWKS), audiência, emissor, expiração e nonce.
 */
@Injectable()
export class OAuthClient {
  private readonly jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  isEnabled(provider: OAuthProviderName): boolean {
    return this.endpoints(provider) !== null;
  }

  authorizationUrl(
    provider: OAuthProviderName,
    input: { state: string; nonce: string; codeVerifier: string; loginHint?: string },
  ): string {
    const endpoints = this.require(provider);
    const params = new URLSearchParams({
      client_id: endpoints.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri(provider),
      scope: endpoints.scope,
      state: input.state,
      nonce: input.nonce,
      code_challenge: pkceChallenge(input.codeVerifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    if (input.loginHint !== undefined) params.set('login_hint', input.loginHint);
    return `${endpoints.authorizationUrl}?${params.toString()}`;
  }

  redirectUri(provider: OAuthProviderName): string {
    return `${this.config.API_URL}/v1/auth/oauth/${provider}/callback`;
  }

  async exchange(
    provider: OAuthProviderName,
    code: string,
    codeVerifier: string,
    nonce: string,
  ): Promise<OAuthIdentity> {
    const endpoints = this.require(provider);
    const response = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri(provider),
        client_id: endpoints.clientId,
        client_secret: endpoints.clientSecret,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new UnauthorizedError(
        'oauth_exchange_failed',
        'Não foi possível concluir o login com o provedor.',
      );
    const tokens = TokenResponse.parse(await response.json());
    let jwks = this.jwks.get(endpoints.jwksUrl);
    if (jwks === undefined) {
      jwks = createRemoteJWKSet(new URL(endpoints.jwksUrl));
      this.jwks.set(endpoints.jwksUrl, jwks);
    }
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(tokens.id_token, jwks, {
        audience: endpoints.clientId,
        clockTolerance: 60,
      }));
    } catch {
      throw new UnauthorizedError('oauth_invalid_token', 'Token do provedor inválido.');
    }
    if (typeof payload.iss !== 'string' || !endpoints.issuerMatches(payload.iss, payload)) {
      throw new UnauthorizedError('oauth_invalid_issuer', 'Emissor do token não reconhecido.');
    }
    const claims = IdTokenClaims.parse(payload);
    if (claims.nonce !== nonce)
      throw new UnauthorizedError(
        'oauth_invalid_nonce',
        'Resposta do provedor não corresponde à solicitação.',
      );
    const email =
      claims.email ?? (provider === 'microsoft' ? claims.preferred_username : undefined);
    if (!email?.includes('@')) {
      throw new UnprocessableError('O provedor não informou um e-mail.', 'oauth_email_missing');
    }
    const emailVerified =
      provider === 'google'
        ? claims.email_verified === true || claims.email_verified === 'true'
        : claims.tid !== undefined;
    return {
      provider,
      subject: claims.sub,
      email: email.toLowerCase(),
      emailVerified,
      name: claims.name ?? null,
    };
  }

  private require(provider: OAuthProviderName): ProviderEndpoints {
    const endpoints = this.endpoints(provider);
    if (endpoints === null)
      throw new UnprocessableError(`Login com ${provider} não está configurado.`, 'oauth_disabled');
    return endpoints;
  }

  private endpoints(provider: OAuthProviderName): ProviderEndpoints | null {
    const config = this.config;
    if (provider === 'google') {
      if (
        config.OAUTH_GOOGLE_CLIENT_ID === undefined ||
        config.OAUTH_GOOGLE_CLIENT_SECRET === undefined
      )
        return null;
      return {
        clientId: config.OAUTH_GOOGLE_CLIENT_ID,
        clientSecret: config.OAUTH_GOOGLE_CLIENT_SECRET,
        authorizationUrl: config.OAUTH_GOOGLE_AUTHORIZATION_URL,
        tokenUrl: config.OAUTH_GOOGLE_TOKEN_URL,
        jwksUrl: config.OAUTH_GOOGLE_JWKS_URL,
        issuerMatches: (issuer) =>
          issuer === config.OAUTH_GOOGLE_ISSUER || issuer === 'accounts.google.com',
        scope: 'openid email profile',
      };
    }
    if (
      config.OAUTH_MICROSOFT_CLIENT_ID === undefined ||
      config.OAUTH_MICROSOFT_CLIENT_SECRET === undefined
    )
      return null;
    const base = `${config.OAUTH_MICROSOFT_AUTHORITY}/${config.OAUTH_MICROSOFT_TENANT}`;
    return {
      clientId: config.OAUTH_MICROSOFT_CLIENT_ID,
      clientSecret: config.OAUTH_MICROSOFT_CLIENT_SECRET,
      authorizationUrl: `${base}/oauth2/v2.0/authorize`,
      tokenUrl: `${base}/oauth2/v2.0/token`,
      jwksUrl: config.OAUTH_MICROSOFT_JWKS_URL ?? `${base}/discovery/v2.0/keys`,
      // Emissor multi-tenant: https://login.microsoftonline.com/{tid}/v2.0
      issuerMatches: (issuer, payload) =>
        typeof payload.tid === 'string' &&
        issuer === `${config.OAUTH_MICROSOFT_AUTHORITY}/${payload.tid}/v2.0`,
      scope: 'openid email profile',
    };
  }
}
