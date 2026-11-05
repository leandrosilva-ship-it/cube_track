import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity/identity.module.js';
import { AuditService } from './application/audit.service.js';
import { LgpdService } from './application/lgpd.service.js';
import { AuditRepository } from './infrastructure/audit.repository.js';
import { LgpdRepository } from './infrastructure/lgpd.repository.js';
import { AuditController } from './presentation/audit.controller.js';
import { AdminLgpdController, LgpdController } from './presentation/lgpd.controller.js';

/** Auditoria avançada (busca/exportação) e LGPD (consentimento, solicitações de titular) — ADR
 * 0057. `AccessModule` é `@Global()`; `IdentityModule` é importado por `AuthService` (perfil e
 * anonimização, usados pela exportação/exclusão de dados do titular). */
@Module({
  imports: [IdentityModule],
  controllers: [AuditController, LgpdController, AdminLgpdController],
  providers: [AuditRepository, AuditService, LgpdRepository, LgpdService],
})
export class GovernanceModule {}
