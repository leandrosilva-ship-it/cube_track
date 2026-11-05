import { Injectable } from '@nestjs/common';
import { GOOGLE_OAUTH_SCOPES, MICROSOFT_OAUTH_SCOPES } from '@cube-track/shared';
import { z } from 'zod';

import { UnauthorizedError } from '../../../core/errors/problems.js';

export type OAuthConnectionProvider = 'google' | 'microsoft';

/** Token de injeção (ADR 0056): o resto do módulo nunca conhece os endpoints/formatos específicos de
 * cada provedor — só esta implementação. Trocar de implementação (ou mockar em teste, como o provedor
 * de IA do Prompt 14) significa só trocar quem está registrado neste token. */
export const OAUTH_CONNECTION_CLIENT = Symbol('OAUTH_CONNECTION_CLIENT');

export interface OAuthTokenSet {
  accessToken: string;
  /** `null` quando o provedor não reemitiu um novo (ex.: a maioria dos refreshes do Google) — o
   * chamador mantém o anterior nesse caso. */
  refreshToken: string | null;
  expiresInSeconds: number;
}

export interface ExternalFileMetadata {
  name: string;
  mimeType: string | null;
  url: string;
}

export interface OAuthConnectionClient {
  authorizationUrl(
    provider: OAuthConnectionProvider,
    input: { clientId: string; redirectUri: string; state: string },
  ): string;
  exchangeCode(
    provider: OAuthConnectionProvider,
    input: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  ): Promise<OAuthTokenSet>;
  refreshAccessToken(
    provider: OAuthConnectionProvider,
    input: { clientId: string; clientSecret: string; refreshToken: string },
  ): Promise<OAuthTokenSet>;
  fetchFileMetadata(
    provider: OAuthConnectionProvider,
    input: { accessToken: string; fileId: string },
  ): Promise<ExternalFileMetadata>;
}

const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_FILE_URL = (fileId: string) =>
  `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink`;

const MICROSOFT_AUTHORIZATION_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MICROSOFT_DRIVE_ITEM_URL = (fileId: string) =>
  `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}?$select=name,file,webUrl`;

const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});

/**
 * Cliente OAuth das conexões de integração (Google Calendar/Drive/Gmail, Microsoft Graph) — distinto
 * do `OAuthClient` do login (`modules/identity/infrastructure/oauth.client.ts`): aquele é um único
 * client plataforma inteira (credenciais do `.env`) só para validar `id_token` de login, nunca persiste
 * tokens nem tem refresh. Este é BYOK por tenant (client id/secret do PRÓPRIO tenant, `integration_apps`),
 * pede escopos mais amplos (calendário com escrita, Drive/Gmail leitura) e PERSISTE+ATUALIZA
 * `access_token`/`refresh_token` (`integration_connections`), com uma rota de callback própria
 * (`/v1/integrations/:provider/callback`, nunca `/v1/auth/oauth/:provider/callback`).
 */
@Injectable()
export class HttpOAuthConnectionClient implements OAuthConnectionClient {
  authorizationUrl(
    provider: OAuthConnectionProvider,
    input: { clientId: string; redirectUri: string; state: string },
  ): string {
    if (provider === 'google') {
      const params = new URLSearchParams({
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        response_type: 'code',
        scope: GOOGLE_OAUTH_SCOPES,
        state: input.state,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      });
      return `${GOOGLE_AUTHORIZATION_URL}?${params.toString()}`;
    }
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: MICROSOFT_OAUTH_SCOPES,
      state: input.state,
    });
    return `${MICROSOFT_AUTHORIZATION_URL}?${params.toString()}`;
  }

  async exchangeCode(
    provider: OAuthConnectionProvider,
    input: { clientId: string; clientSecret: string; redirectUri: string; code: string },
  ): Promise<OAuthTokenSet> {
    const tokenUrl = provider === 'google' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      ...(provider === 'microsoft' ? { scope: MICROSOFT_OAUTH_SCOPES } : {}),
    });
    return this.postToken(tokenUrl, body);
  }

  async refreshAccessToken(
    provider: OAuthConnectionProvider,
    input: { clientId: string; clientSecret: string; refreshToken: string },
  ): Promise<OAuthTokenSet> {
    const tokenUrl = provider === 'google' ? GOOGLE_TOKEN_URL : MICROSOFT_TOKEN_URL;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      ...(provider === 'microsoft' ? { scope: MICROSOFT_OAUTH_SCOPES } : {}),
    });
    return this.postToken(tokenUrl, body);
  }

  async fetchFileMetadata(
    provider: OAuthConnectionProvider,
    input: { accessToken: string; fileId: string },
  ): Promise<ExternalFileMetadata> {
    const url = provider === 'google' ? GOOGLE_DRIVE_FILE_URL(input.fileId) : MICROSOFT_DRIVE_ITEM_URL(input.fileId);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new UnauthorizedError('external_file_unavailable', 'Não foi possível ler o arquivo no provedor.');
    const raw = (await response.json()) as Record<string, unknown>;
    if (provider === 'google') {
      return {
        name: typeof raw.name === 'string' ? raw.name : input.fileId,
        mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : null,
        url: typeof raw.webViewLink === 'string' ? raw.webViewLink : `https://drive.google.com/file/d/${input.fileId}/view`,
      };
    }
    const file = raw.file as { mimeType?: unknown } | undefined;
    return {
      name: typeof raw.name === 'string' ? raw.name : input.fileId,
      mimeType: typeof file?.mimeType === 'string' ? file.mimeType : null,
      url: typeof raw.webUrl === 'string' ? raw.webUrl : `https://onedrive.live.com/?id=${input.fileId}`,
    };
  }

  private async postToken(tokenUrl: string, body: URLSearchParams): Promise<OAuthTokenSet> {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new UnauthorizedError('oauth_exchange_failed', 'Não foi possível concluir a conexão com o provedor.');
    const parsed = TokenResponse.parse(await response.json());
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      expiresInSeconds: parsed.expires_in,
    };
  }
}
