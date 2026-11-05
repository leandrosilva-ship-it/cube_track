import { Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { SecurityPolicyService } from '../application/security-policy.service.js';
import * as S from './security-policy.schemas.js';

/** Política de segurança do tenant (ADR 0057): senha, sessão e allowlist de IP/domínio. */
@Controller('security/policy')
export class SecurityPolicyController {
  constructor(private readonly policy: SecurityPolicyService) {}

  @Get()
  @Endpoint({
    summary: 'Obter a política de segurança da organização',
    description:
      'Qualquer membro autenticado pode ler (não expõe segredo). Ausência de configuração própria devolve os padrões seguros.',
    tags: ['security'],
    response: S.SecurityPolicyResponse,
  })
  get(@CurrentPrincipal() user: AuthPrincipal) {
    return this.policy.get(user);
  }

  @Patch()
  @Audited({ action: 'security_policy.update', entityType: 'security_policy' })
  @Endpoint({
    summary: 'Atualizar a política de segurança da organização',
    description: 'Requer `security_policy.manage`. Mescla por sub-objeto (senha/sessão/allowlist).',
    tags: ['security'],
    body: S.UpdateSecurityPolicyBody,
    response: S.SecurityPolicyResponse,
  })
  update(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof S.UpdateSecurityPolicyBody>,
  ) {
    return this.policy.update(user, body);
  }
}
