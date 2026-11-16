import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, QUEUES } from '@cube-track/shared';
import { encryptSecret } from '@cube-track/shared/crypto';
import { eq } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { ValidationError } from '../../../core/errors/problems.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../../../core/queues/queues.module.js';
import { AccessService } from '../../access/application/access.service.js';
import { checkEmailHost } from '../domain/email-settings-policy.js';

const { emailSettings, users } = schema;

export interface EmailSettingsDto {
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  hasPassword: boolean;
  fromAddress: string | null;
  updatedAt: string | null;
}

export interface UpdateEmailSettingsInput {
  enabled?: boolean | undefined;
  host?: string | undefined;
  port?: number | undefined;
  secure?: boolean | undefined;
  username?: string | null | undefined;
  /** Texto puro — cifrada antes de salvar; nunca devolvida (ver `hasPassword`). `undefined` mantém
   * a senha atual; `null` limpa. */
  password?: string | null | undefined;
  fromAddress?: string | null | undefined;
}

/**
 * Configuração de SMTP do TENANT — não por workspace, mesmo padrão de `AiSettingsService`: cada
 * organização pode usar seu próprio provedor de envio, substituindo o SMTP padrão da plataforma.
 * `enabled` nasce `false`: configurar os campos não ativa sozinho, evitando enviar e-mails reais
 * de um tenant a meio de preencher o formulário.
 */
@Injectable()
export class EmailSettingsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
  ) {}

  async get(user: AuthPrincipal): Promise<EmailSettingsDto> {
    await this.access.assert(user, 'email.manage', { type: 'tenant' });
    return this.toDto(await this.row(user.tenantId));
  }

  async update(user: AuthPrincipal, input: UpdateEmailSettingsInput): Promise<EmailSettingsDto> {
    await this.access.assert(user, 'email.manage', { type: 'tenant' });
    if (input.host !== undefined) {
      const check = checkEmailHost(input.host);
      if (!check.allowed)
        throw new ValidationError([{ path: 'body.host', message: check.reason ?? 'Host inválido.' }]);
    }
    const existing = await this.row(user.tenantId);
    const [row] = await this.runner.tx
      .insert(emailSettings)
      .values({
        tenantId: user.tenantId,
        enabled: input.enabled ?? existing?.enabled ?? false,
        host: input.host ?? existing?.host ?? null,
        port: input.port ?? existing?.port ?? null,
        secure: input.secure ?? existing?.secure ?? true,
        username: input.username === undefined ? (existing?.username ?? null) : input.username,
        passwordCiphertext:
          input.password === undefined
            ? (existing?.passwordCiphertext ?? null)
            : input.password === null
              ? null
              : encryptSecret(input.password, this.config.ENCRYPTION_KEY),
        fromAddress:
          input.fromAddress === undefined ? (existing?.fromAddress ?? null) : input.fromAddress,
        updatedBy: user.userId,
      })
      .onConflictDoUpdate({
        target: emailSettings.tenantId,
        set: {
          enabled: input.enabled ?? existing?.enabled ?? false,
          host: input.host ?? existing?.host ?? null,
          port: input.port ?? existing?.port ?? null,
          secure: input.secure ?? existing?.secure ?? true,
          username: input.username === undefined ? (existing?.username ?? null) : input.username,
          ...(input.password !== undefined
            ? {
                passwordCiphertext:
                  input.password === null ? null : encryptSecret(input.password, this.config.ENCRYPTION_KEY),
              }
            : {}),
          fromAddress:
            input.fromAddress === undefined ? (existing?.fromAddress ?? null) : input.fromAddress,
          updatedBy: user.userId,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao salvar a configuração de SMTP.');
    this.events.recordChange({
      action: 'email_settings.update',
      entityType: 'email_settings',
      entityId: row.id,
      after: {
        enabled: row.enabled,
        host: row.host,
        port: row.port,
        secure: row.secure,
        username: row.username,
        hasPassword: row.passwordCiphertext !== null,
        fromAddress: row.fromAddress,
      },
    });
    return this.toDto(row);
  }

  /** Enfileira um e-mail de teste para o PRÓPRIO usuário, pelo mesmo caminho de produção (fila do
   * worker) — não existe um segundo código de envio de e-mail só para testes. */
  async sendTest(user: AuthPrincipal): Promise<void> {
    await this.access.assert(user, 'email.manage', { type: 'tenant' });
    const [row] = await this.runner.tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, user.userId));
    if (row === undefined) throw new Error('Usuário não encontrado.');
    await this.queues[QUEUES.emails].add(
      'smtp_test',
      {
        to: row.email,
        template: 'smtp_test',
        locale: 'pt-BR',
        tenantId: user.tenantId,
        data: {},
      },
      { jobId: `smtp_test.${user.tenantId}.${newId()}` },
    );
  }

  private async row(tenantId: string) {
    const [row] = await this.runner.tx
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.tenantId, tenantId));
    return row;
  }

  private toDto(row: typeof emailSettings.$inferSelect | undefined): EmailSettingsDto {
    if (row === undefined) {
      return {
        enabled: false,
        host: null,
        port: null,
        secure: true,
        username: null,
        hasPassword: false,
        fromAddress: null,
        updatedAt: null,
      };
    }
    return {
      enabled: row.enabled,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      hasPassword: row.passwordCiphertext !== null,
      fromAddress: row.fromAddress,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
