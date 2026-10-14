import { Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { requireContext, type AuthPrincipal } from '../../../core/context/request-context.js';
import { UnauthorizedError } from '../../../core/errors/problems.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import { AuthService, type LoginResult } from '../application/auth.service.js';
import { SessionService } from '../application/session.service.js';
import {
  clearRefreshCookie,
  readRefreshToken,
  sessionResponse,
  setRefreshCookie,
  wantsBodyRefresh,
} from './cookies.js';
import * as S from './schemas.js';
import type { z } from 'zod';

const AUTH_LIMIT = { limit: 10, windowSeconds: 60, by: 'ip+email' as const, bucket: 'auth' };

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private respond(result: LoginResult, request: Request, response: Response) {
    if (result.kind === 'mfa')
      return {
        mfaRequired: true as const,
        challengeToken: result.challengeToken,
        expiresIn: result.expiresIn,
      };
    setRefreshCookie(response, this.config, result.session);
    return sessionResponse(result.session, wantsBodyRefresh(request));
  }

  @Post('signup')
  @RateLimit({ limit: 5, windowSeconds: 3600, by: 'ip', bucket: 'signup' })
  @Audited({ action: 'auth.signup', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Criar conta e organização',
    tags: ['auth'],
    public: true,
    status: 201,
    body: S.SignupBody,
    response: S.SessionResponse,
    errors: [409],
  })
  async signup(
    @Input('body') body: z.infer<typeof S.SignupBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.signup(body);
    setRefreshCookie(response, this.config, session);
    return sessionResponse(session, wantsBodyRefresh(request));
  }

  @Post('login')
  @RateLimit(AUTH_LIMIT)
  @Audited({ action: 'auth.login', entityType: 'session', transactional: false })
  @Endpoint({
    summary: 'Entrar com e-mail e senha',
    description:
      'Retorna a sessão ou, com MFA ativo, um desafio (`mfaRequired`). O refresh token vai em cookie HttpOnly.',
    tags: ['auth'],
    public: true,
    status: 200,
    body: S.LoginBody,
    response: S.LoginResponse,
    errors: [423],
  })
  async login(
    @Input('body') body: z.infer<typeof S.LoginBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(await this.auth.login(body.email, body.password), request, response);
  }

  @Post('mfa/verify')
  @RateLimit({ limit: 10, windowSeconds: 60, by: 'ip', bucket: 'mfa' })
  @Audited({ action: 'auth.mfa_verify', entityType: 'session', transactional: false })
  @Endpoint({
    summary: 'Concluir login com código TOTP ou de recuperação',
    tags: ['auth'],
    public: true,
    status: 200,
    body: S.MfaVerifyBody,
    response: S.SessionResponse,
  })
  async verifyMfa(
    @Input('body') body: z.infer<typeof S.MfaVerifyBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.auth.completeMfa(body.challengeToken, body.code, body.recoveryCode);
    setRefreshCookie(response, this.config, session);
    return sessionResponse(session, wantsBodyRefresh(request));
  }

  @Post('magic-link')
  @RateLimit({ limit: 5, windowSeconds: 900, by: 'ip+email', bucket: 'magic' })
  @Audited({ action: 'auth.magic_link_requested', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Solicitar link mágico por e-mail',
    tags: ['auth'],
    public: true,
    status: 202,
    body: S.EmailBody,
    response: S.Accepted,
  })
  async magicLink(@Input('body') body: z.infer<typeof S.EmailBody>) {
    await this.auth.requestMagicLink(body.email);
    return { status: 'accepted' as const };
  }

  @Post('magic-link/verify')
  @RateLimit({ limit: 20, windowSeconds: 900, by: 'ip', bucket: 'magic-verify' })
  @Audited({ action: 'auth.magic_link_login', entityType: 'session', transactional: false })
  @Endpoint({
    summary: 'Entrar com link mágico',
    tags: ['auth'],
    public: true,
    status: 200,
    body: S.TokenBody,
    response: S.LoginResponse,
  })
  async verifyMagicLink(
    @Input('body') body: z.infer<typeof S.TokenBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.respond(await this.auth.verifyMagicLink(body.token), request, response);
  }

  @Post('password/forgot')
  @RateLimit({ limit: 5, windowSeconds: 900, by: 'ip+email', bucket: 'forgot' })
  @Audited({ action: 'auth.password_reset_requested', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Solicitar redefinição de senha',
    tags: ['auth'],
    public: true,
    status: 202,
    body: S.EmailBody,
    response: S.Accepted,
  })
  async forgot(@Input('body') body: z.infer<typeof S.EmailBody>) {
    await this.auth.requestPasswordReset(body.email);
    return { status: 'accepted' as const };
  }

  @Post('password/reset')
  @RateLimit({ limit: 10, windowSeconds: 900, by: 'ip', bucket: 'reset' })
  @Audited({ action: 'auth.password_reset', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Redefinir a senha com o token recebido',
    tags: ['auth'],
    public: true,
    status: 204,
    body: S.ResetPasswordBody,
  })
  async reset(@Input('body') body: z.infer<typeof S.ResetPasswordBody>) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Post('email/verify')
  @Audited({ action: 'auth.email_verified', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Confirmar e-mail',
    tags: ['auth'],
    public: true,
    status: 204,
    body: S.TokenBody,
  })
  async verifyEmail(@Input('body') body: z.infer<typeof S.TokenBody>) {
    await this.auth.verifyEmail(body.token);
  }

  @Post('refresh')
  @RateLimit({ limit: 60, windowSeconds: 60, by: 'ip', bucket: 'refresh' })
  @Audited({ action: 'auth.refresh', entityType: 'session', transactional: false })
  @Endpoint({
    summary: 'Renovar sessão (refresh token rotativo)',
    tags: ['auth'],
    public: true,
    status: 200,
    body: S.RefreshBody,
    response: S.SessionResponse,
  })
  async refresh(
    @Input('body') body: z.infer<typeof S.RefreshBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = readRefreshToken(request, body.refreshToken);
    if (token === undefined) throw new UnauthorizedError('refresh_missing', 'Sessão ausente.');
    try {
      const session = await this.sessions.refresh(token);
      setRefreshCookie(response, this.config, session);
      return sessionResponse(session, wantsBodyRefresh(request));
    } catch (error) {
      clearRefreshCookie(response, this.config);
      throw error;
    }
  }

  @Post('logout')
  @Audited({ action: 'auth.logout', entityType: 'session', transactional: false })
  @Endpoint({
    summary: 'Encerrar a sessão atual',
    tags: ['auth'],
    public: true,
    status: 204,
    body: S.RefreshBody,
  })
  async logout(
    @Input('body') body: z.infer<typeof S.RefreshBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = requireContext().principal;
    const token = readRefreshToken(request, body.refreshToken);
    if (principal !== null) await this.sessions.revoke(principal.sessionId, 'logout');
    else if (token !== undefined) await this.sessions.revokeByRefreshToken(token, 'logout');
    clearRefreshCookie(response, this.config);
  }

  @Post('logout-all')
  @Audited({ action: 'auth.logout_all', entityType: 'session', transactional: false })
  @Endpoint({ summary: 'Encerrar todas as sessões do usuário', tags: ['auth'], status: 204 })
  async logoutAll(
    @CurrentPrincipal() user: AuthPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.sessions.revokeAllForUser(user.userId, 'logout_all');
    clearRefreshCookie(response, this.config);
  }

  @Get('organizations')
  @Endpoint({
    summary: 'Organizações do usuário (seletor de organização)',
    tags: ['auth'],
    response: S.Organizations,
  })
  async organizations(@CurrentPrincipal() user: AuthPrincipal) {
    return { data: await this.auth.organizations(user.userId) };
  }

  @Post('switch-organization')
  @Audited({ action: 'auth.switch_tenant', entityType: 'session', transactional: false })
  @Endpoint({
    summary: 'Trocar de organização',
    tags: ['auth'],
    status: 200,
    body: S.SwitchBody,
    response: S.SessionResponse,
  })
  async switchOrganization(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.SwitchBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.sessions.switchTenant(user.userId, user.sessionId, body.tenantId);
    setRefreshCookie(response, this.config, session);
    return sessionResponse(session, wantsBodyRefresh(request));
  }

  @Get('oauth/:provider')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip', bucket: 'oauth' })
  @Endpoint({
    summary: 'Iniciar login com Google ou Microsoft (redireciona ao provedor)',
    tags: ['auth'],
    public: true,
    params: S.ProviderParams,
    query: S.OAuthStartQuery,
    errors: [302],
  })
  async oauthStart(
    @Input('params') params: z.infer<typeof S.ProviderParams>,
    @Input('query') query: z.infer<typeof S.OAuthStartQuery>,
    @Res() response: Response,
  ) {
    const url = await this.auth.startOAuth(
      params.provider,
      requireContext().tenant,
      query.loginHint,
    );
    response.redirect(302, url);
  }

  @Get('oauth/:provider/callback')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip', bucket: 'oauth' })
  @Endpoint({
    summary: 'Callback OAuth (redireciona ao app)',
    description:
      'Em sucesso, grava o refresh cookie e redireciona para `${APP_URL}/auth/callback`; com MFA, para `/auth/mfa?challenge=`.',
    tags: ['auth'],
    public: true,
    params: S.ProviderParams,
    query: S.OAuthCallbackQuery,
    errors: [302],
  })
  async oauthCallback(
    @Input('params') params: z.infer<typeof S.ProviderParams>,
    @Input('query') query: z.infer<typeof S.OAuthCallbackQuery>,
    @Res() response: Response,
  ) {
    const fail = (code: string) => {
      response.redirect(
        302,
        `${this.config.APP_URL}/auth/callback?error=${encodeURIComponent(code)}`,
      );
    };
    if (query.error !== undefined || query.code === undefined) {
      fail(query.error ?? 'oauth_cancelled');
      return;
    }
    try {
      const result = await this.auth.completeOAuth(params.provider, query.code, query.state);
      if (result.kind === 'mfa') {
        response.redirect(
          302,
          `${this.config.APP_URL}/auth/mfa?challenge=${encodeURIComponent(result.challengeToken)}`,
        );
        return;
      }
      setRefreshCookie(response, this.config, result.session);
      response.redirect(302, `${this.config.APP_URL}/auth/callback?status=ok`);
    } catch (error) {
      fail(
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'oauth_failed',
      );
    }
  }
}
