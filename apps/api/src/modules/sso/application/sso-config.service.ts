import { Inject, Injectable } from '@nestjs/common';
import { decryptSecret, encryptSecret } from '@cube-track/shared/crypto';
import { UpsertSamlConfigSchema, type SamlAttributeMapping, type UpsertSamlConfig } from '@cube-track/shared';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { SsoConfigRepository, type SsoConfigRow } from '../infrastructure/sso-config.repository.js';

export interface SsoConfigDto {
  isEnabled: boolean;
  idpEntityId: string | null;
  idpSsoUrl: string | null;
  idpSloUrl: string | null;
  metadataUrl: string | null;
  hasCertificate: boolean;
  attributeMapping: SamlAttributeMapping;
  provisionOnFirstLogin: boolean;
  defaultRoleKey: string;
  updatedAt: string | null;
}

/**
 * Configuração de SSO SAML 2.0 do tenant (ADR 0057) — mesmo padrão BYOK de `AiSettingsService`: o
 * certificado do IdP é cifrado antes de salvar e NUNCA devolvido em texto puro (`hasCertificate`).
 */
@Injectable()
export class SsoConfigService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly repository: SsoConfigRepository,
    private readonly events: DomainEvents,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(user: AuthPrincipal): Promise<SsoConfigDto> {
    await this.access.assert(user, 'sso.manage', { type: 'tenant' });
    return this.toDto(await this.repository.find(this.runner.tx, user.tenantId));
  }

  /** Lido sem permissão (usado pelo login/ACS, pré-sessão) — nunca inclui o certificado. */
  async internalConfig(tenantId: string): Promise<SsoConfigRow | null> {
    return this.repository.find(this.runner.tx, tenantId);
  }

  decryptCertificate(row: SsoConfigRow): string {
    return decryptSecret(row.idpCertificateCiphertext, this.config.ENCRYPTION_KEY);
  }

  async update(user: AuthPrincipal, input: UpsertSamlConfig): Promise<SsoConfigDto> {
    await this.access.assert(user, 'sso.manage', { type: 'tenant' });
    const parsed = UpsertSamlConfigSchema.parse(input);
    const row = await this.repository.upsert(this.runner.tx, user.tenantId, {
      isEnabled: parsed.isEnabled,
      idpEntityId: parsed.idpEntityId,
      idpSsoUrl: parsed.idpSsoUrl,
      idpSloUrl: parsed.idpSloUrl,
      idpCertificateCiphertext: encryptSecret(parsed.idpCertificate.trim(), this.config.ENCRYPTION_KEY),
      metadataUrl: parsed.metadataUrl,
      attributeMapping: parsed.attributeMapping,
      provisionOnFirstLogin: parsed.provisionOnFirstLogin,
      defaultRoleKey: parsed.defaultRoleKey,
      updatedBy: user.userId,
    });
    this.events.recordChange({
      action: 'sso_config.update',
      entityType: 'sso_configuration',
      entityId: row.id,
      after: { isEnabled: row.isEnabled, idpEntityId: row.idpEntityId, idpSsoUrl: row.idpSsoUrl },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'sso_config.changed',
      aggregateType: 'sso_configuration',
      aggregateId: row.id,
      payload: { isEnabled: row.isEnabled },
      actorId: user.userId,
    });
    return this.toDto(row);
  }

  private toDto(row: SsoConfigRow | null): SsoConfigDto {
    if (row === null) {
      return {
        isEnabled: false,
        idpEntityId: null,
        idpSsoUrl: null,
        idpSloUrl: null,
        metadataUrl: null,
        hasCertificate: false,
        attributeMapping: { email: 'email', name: 'name', orgUnit: null },
        provisionOnFirstLogin: true,
        defaultRoleKey: 'guest',
        updatedAt: null,
      };
    }
    return {
      isEnabled: row.isEnabled,
      idpEntityId: row.idpEntityId,
      idpSsoUrl: row.idpSsoUrl,
      idpSloUrl: row.idpSloUrl,
      metadataUrl: row.metadataUrl,
      hasCertificate: true,
      attributeMapping: row.attributeMapping as SamlAttributeMapping,
      provisionOnFirstLogin: row.provisionOnFirstLogin,
      defaultRoleKey: row.defaultRoleKey,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
