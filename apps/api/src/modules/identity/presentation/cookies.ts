import type { Request, Response } from 'express';

import type { AppConfig } from '../../../core/config/config.js';
import type { IssuedSession } from '../application/session.service.js';

export const REFRESH_COOKIE = 'ct_refresh';
const REFRESH_COOKIE_PATH = '/v1/auth';

/** Grava o refresh token em cookie HttpOnly (escopo restrito às rotas de autenticação). */
export function setRefreshCookie(
  response: Response,
  config: AppConfig,
  session: IssuedSession,
): void {
  response.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    expires: session.refreshExpiresAt,
    ...(config.COOKIE_DOMAIN === undefined ? {} : { domain: config.COOKIE_DOMAIN }),
  });
}

export function clearRefreshCookie(response: Response, config: AppConfig): void {
  response.clearCookie(REFRESH_COOKIE, {
    path: REFRESH_COOKIE_PATH,
    ...(config.COOKIE_DOMAIN === undefined ? {} : { domain: config.COOKIE_DOMAIN }),
  });
}

export function readRefreshToken(
  request: Request,
  bodyToken: string | undefined,
): string | undefined {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE] ?? bodyToken;
}

/** Clientes nativos (sem cookies) pedem o refresh token no corpo com `X-Refresh-Transport: body`. */
export function wantsBodyRefresh(request: Request): boolean {
  return request.headers['x-refresh-transport'] === 'body';
}

/** Representação pública da sessão emitida. */
export function sessionResponse(session: IssuedSession, includeRefresh: boolean) {
  return {
    accessToken: session.accessToken,
    tokenType: session.tokenType,
    expiresIn: session.expiresIn,
    sessionId: session.sessionId,
    user: session.user,
    tenant: session.tenant,
    ...(includeRefresh ? { refreshToken: session.refreshToken } : {}),
  };
}
