import { Controller, Get, Post } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { RateLimit } from '../../../core/rate-limit/rate-limit.js';
import { AccessService } from '../../access/application/access.service.js';
import { AuthService } from '../application/auth.service.js';
import { MfaService } from '../application/mfa.service.js';
import { password } from './schemas.js';

const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    locale: z.string(),
    timezone: z.string(),
    mfaEnabled: z.boolean(),
  }),
  tenant: z.object({
    id: z.uuid(),
    kind: z.enum(['member', 'guest']),
    roleKey: z.string(),
    permissions: z.array(z.string()),
  }),
  sessionId: z.uuid(),
});
const CodeBody = z.object({ code: z.string().regex(/^\d{6}$/) });
const MfaSetupResponse = z.object({ secret: z.string(), otpauthUri: z.string() });
const RecoveryCodesResponse = z.object({ recoveryCodes: z.array(z.string()) });
const ChangePasswordBody = z.object({ currentPassword: password, newPassword: password });

@Controller('me')
export class MeController {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly mfa: MfaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @Endpoint({
    summary: 'Usuário autenticado e contexto da organização',
    tags: ['me'],
    response: MeResponse,
  })
  async me(@CurrentPrincipal() principal: AuthPrincipal) {
    const [user] = await this.runner.tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        avatarUrl: schema.users.avatarUrl,
        locale: schema.users.locale,
        timezone: schema.users.timezone,
        mfaEnabled: schema.users.mfaEnabled,
      })
      .from(schema.users)
      .where(eq(schema.users.id, principal.userId));
    if (user === undefined) throw new NotFoundError('Usuário');
    const access = await this.access.principal(principal);
    return {
      user,
      tenant: {
        id: principal.tenantId,
        kind: access.kind,
        roleKey: access.tenantRoleKey,
        permissions: [...access.tenantPermissions],
      },
      sessionId: principal.sessionId,
    };
  }

  @Post('mfa/setup')
  @Audited({ action: 'auth.mfa_setup', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Iniciar configuração de MFA (TOTP)',
    tags: ['me'],
    status: 200,
    response: MfaSetupResponse,
  })
  setupMfa(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.mfa.setup(principal.userId);
  }

  @Post('mfa/enable')
  @RateLimit({ limit: 10, windowSeconds: 300, by: 'user', bucket: 'mfa-manage' })
  @Audited({ action: 'auth.mfa_enable', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Ativar MFA confirmando um código',
    tags: ['me'],
    status: 200,
    body: CodeBody,
    response: RecoveryCodesResponse,
  })
  enableMfa(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Input('body') body: z.infer<typeof CodeBody>,
  ) {
    return this.mfa.enable(principal.userId, principal.tenantId, body.code);
  }

  @Post('mfa/disable')
  @RateLimit({ limit: 10, windowSeconds: 300, by: 'user', bucket: 'mfa-manage' })
  @Audited({ action: 'auth.mfa_disable', entityType: 'user', transactional: false })
  @Endpoint({ summary: 'Desativar MFA', tags: ['me'], status: 204, body: CodeBody })
  async disableMfa(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Input('body') body: z.infer<typeof CodeBody>,
  ) {
    await this.mfa.disable(principal.userId, principal.tenantId, body.code);
  }

  @Post('mfa/recovery-codes')
  @RateLimit({ limit: 10, windowSeconds: 300, by: 'user', bucket: 'mfa-manage' })
  @Audited({ action: 'auth.mfa_recovery_codes', entityType: 'user', transactional: false })
  @Endpoint({
    summary: 'Gerar novos códigos de recuperação',
    tags: ['me'],
    status: 200,
    body: CodeBody,
    response: RecoveryCodesResponse,
  })
  regenerate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Input('body') body: z.infer<typeof CodeBody>,
  ) {
    return this.mfa.regenerateRecoveryCodes(principal.userId, principal.tenantId, body.code);
  }

  @Post('password')
  @RateLimit({ limit: 10, windowSeconds: 900, by: 'user', bucket: 'password-change' })
  @Audited({ action: 'auth.password_change', entityType: 'user', transactional: false })
  @Endpoint({ summary: 'Alterar a senha', tags: ['me'], status: 204, body: ChangePasswordBody })
  async changePassword(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Input('body') body: z.infer<typeof ChangePasswordBody>,
  ) {
    await this.auth.changePassword(
      principal.userId,
      principal.tenantId,
      body.currentPassword,
      body.newPassword,
    );
  }
}
