import { Controller, Delete, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { requireContext, type AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { IdParams } from '../../../core/http/schemas.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import { InvitationService } from '../application/invitation.service.js';
import { sessionResponse, setRefreshCookie, wantsBodyRefresh } from './cookies.js';
import { email, password, SessionResponse } from './schemas.js';

const CreateInvitationBody = z.object({
  email,
  roleId: z.uuid(),
  kind: z.enum(['member', 'guest']).default('member'),
  resource: z
    .object({ type: z.enum(['workspace', 'board', 'item']), id: z.uuid(), roleId: z.uuid() })
    .optional(),
  message: z.string().max(1000).optional(),
});
const TokenParams = z.object({ token: z.string().min(16).max(256) });
const AcceptBody = z.object({
  token: z.string().min(16).max(256),
  name: z.string().trim().min(2).max(120).optional(),
  password: password.optional(),
});

@Controller('invitations')
export class InvitationsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly invitations: InvitationService,
  ) {}

  @Post()
  @Audited({ action: 'invitation.create', entityType: 'invitation' })
  @Endpoint({
    summary: 'Convidar membro ou convidado externo por e-mail',
    tags: ['invitations'],
    status: 201,
    body: CreateInvitationBody,
    response: z.object({ id: z.uuid(), email: z.string(), expiresAt: z.date() }),
    errors: [409],
  })
  create(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof CreateInvitationBody>,
  ) {
    return this.invitations.create(user, body);
  }

  @Delete(':id')
  @Audited({ action: 'invitation.revoke', entityType: 'invitation' })
  @Endpoint({
    summary: 'Revogar convite pendente',
    tags: ['invitations'],
    status: 204,
    params: IdParams,
  })
  async revoke(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: { id: string }) {
    await this.invitations.revoke(user, params.id);
  }

  @Get('preview/:token')
  @RateLimit({ limit: 30, windowSeconds: 60, by: 'ip', bucket: 'invite-preview' })
  @Endpoint({
    summary: 'Consultar convite pelo token',
    tags: ['invitations'],
    public: true,
    params: TokenParams,
    response: z.object({
      organization: z.object({ name: z.string(), slug: z.string() }),
      email: z.string(),
      kind: z.enum(['member', 'guest']),
      expiresAt: z.date(),
      accountExists: z.boolean(),
    }),
  })
  preview(@Input('params') params: z.infer<typeof TokenParams>) {
    return this.invitations.preview(params.token);
  }

  @Post('accept')
  @RateLimit({ limit: 10, windowSeconds: 300, by: 'ip', bucket: 'invite-accept' })
  @Audited({ action: 'invitation.accept', entityType: 'invitation', transactional: false })
  @Endpoint({
    summary: 'Aceitar convite (cria conta se necessário) e entrar',
    tags: ['invitations'],
    public: true,
    status: 200,
    body: AcceptBody,
    response: SessionResponse,
  })
  async accept(
    @Input('body') body: z.infer<typeof AcceptBody>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.invitations.accept(body, requireContext().principal);
    setRefreshCookie(response, this.config, session);
    return sessionResponse(session, wantsBodyRefresh(request));
  }
}
