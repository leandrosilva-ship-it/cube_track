import { Inject, Injectable } from '@nestjs/common';
import { schema, type DatabaseHandle } from '@cube-track/db';
import { expandScopes, generateApiToken, isApiScope, type ApiScope } from '@cube-track/shared/api-access';
import { decryptSecret, encryptSecret } from '@cube-track/shared/crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { randomToken, safeEqualString } from '../../../core/crypto/secrets.js';
import { APP_DB } from '../../../core/database/tokens.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { oauthApps, apiTokens } = schema;

type OAuthAppRow = typeof oauthApps.$inferSelect;

export interface OAuthAppDto {
  id: string;
  name: string;
  description: string | null;
  clientId: string;
  scopes: ApiScope[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOAuthAppInput {
  name: string;
  description?: string | null | undefined;
  scopes: string[];
}

export interface UpdateOAuthAppInput {
  name?: string | undefined;
  description?: string | null | undefined;
  scopes?: string[] | undefined;
  isActive?: boolean | undefined;
}

export interface IssuedAppToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** Token de app OAuth (`client_credentials`): vida curta, exige o app chamar de novo ao expirar. */
const APP_TOKEN_TTL_SECONDS = 3_600;

function toDto(row: OAuthAppRow): OAuthAppDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    clientId: row.clientId,
    scopes: row.scopes.filter(isApiScope),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertValidScopes(scopes: string[]): asserts scopes is ApiScope[] {
  if (scopes.length === 0)
    throw new ValidationError([{ path: 'body.scopes', message: 'Informe ao menos um escopo.' }]);
  const invalid = scopes.filter((scope) => !isApiScope(scope));
  if (invalid.length > 0)
    throw new ValidationError([
      { path: 'body.scopes', message: `Escopos desconhecidos: ${invalid.join(', ')}.` },
    ]);
}

/**
 * Apps OAuth (ADR 0056): só existem para emitir tokens de API por `client_credentials` —
 * `POST /v1/oauth/token`. Um app NÃO tem identidade própria no RBAC: o token que ele recebe herda
 * exatamente as permissões de quem registrou o app (`createdBy`), reduzidas pelos `scopes` do PRÓPRIO
 * app (nunca mais do que o app foi cadastrado para fazer) e, por fim, pelos `scopes` pedidos no token
 * (aqui sempre = aos do app, já que não há seleção de escopo no fluxo `client_credentials`).
 */
@Injectable()
export class OAuthAppsService {
  constructor(
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal): Promise<OAuthAppDto[]> {
    await this.access.assert(user, 'api_tokens.manage', { type: 'tenant' });
    const rows = await this.runner.tx
      .select()
      .from(oauthApps)
      .where(and(eq(oauthApps.tenantId, user.tenantId), isNull(oauthApps.deletedAt)))
      .orderBy(desc(oauthApps.createdAt));
    return rows.map(toDto);
  }

  async create(
    user: AuthPrincipal,
    input: CreateOAuthAppInput,
  ): Promise<OAuthAppDto & { clientSecret: string }> {
    await this.access.assert(user, 'api_tokens.manage', { type: 'tenant' });
    assertValidScopes(input.scopes);
    const clientId = `ctkapp_${randomToken(16)}`;
    const clientSecret = randomToken(32);
    const [row] = await this.runner.tx
      .insert(oauthApps)
      .values({
        tenantId: user.tenantId,
        name: input.name,
        description: input.description ?? null,
        clientId,
        clientSecretCiphertext: encryptSecret(clientSecret, this.config.ENCRYPTION_KEY),
        scopes: [...expandScopes(input.scopes)],
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar app OAuth');
    this.events.recordChange({
      action: 'oauth_app.created',
      entityType: 'oauth_app',
      entityId: row.id,
      after: { name: row.name, scopes: row.scopes },
    });
    await this.emitChanged(user, row.id, 'created');
    return { ...toDto(row), clientSecret };
  }

  async update(user: AuthPrincipal, appId: string, input: UpdateOAuthAppInput): Promise<OAuthAppDto> {
    await this.access.assert(user, 'api_tokens.manage', { type: 'tenant' });
    const existing = await this.find(user, appId);
    const requestedScopes = input.scopes;
    if (requestedScopes !== undefined) assertValidScopes(requestedScopes);
    const [row] = await this.runner.tx
      .update(oauthApps)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        scopes: requestedScopes === undefined ? existing.scopes : [...expandScopes(requestedScopes)],
        isActive: input.isActive ?? existing.isActive,
      })
      .where(eq(oauthApps.id, appId))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar app OAuth');
    this.events.recordChange({
      action: 'oauth_app.updated',
      entityType: 'oauth_app',
      entityId: row.id,
    });
    await this.emitChanged(user, row.id, 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, appId: string): Promise<void> {
    await this.access.assert(user, 'api_tokens.manage', { type: 'tenant' });
    const existing = await this.find(user, appId);
    await this.runner.tx
      .update(oauthApps)
      .set({ deletedAt: new Date(), isActive: false })
      .where(eq(oauthApps.id, appId));
    // Excluir o app mata também os tokens que ele já tinha emitido (não ficam órfãos autenticando).
    await this.runner.tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiTokens.oauthAppId, appId),
          eq(apiTokens.tenantId, user.tenantId),
          isNull(apiTokens.revokedAt),
        ),
      );
    this.events.recordChange({
      action: 'oauth_app.deleted',
      entityType: 'oauth_app',
      entityId: appId,
      before: { name: existing.name },
    });
    await this.emitChanged(user, appId, 'deleted');
  }

  /**
   * `POST /v1/oauth/token` (público, `grant_type=client_credentials`): resolve o app por `client_id`
   * SEM contexto de tenant ainda (função `app.resolve_oauth_app`, SECURITY DEFINER — mesmo padrão do
   * link público de formulário), confere o segredo em tempo constante e, só então, abre a transação
   * normal do tenant do app para emitir o novo token.
   */
  async issueToken(clientId: string, clientSecret: string): Promise<IssuedAppToken> {
    const result = await this.database.db.execute<{
      tenant_id: string;
      id: string;
      client_secret_ciphertext: string;
      scopes: string[];
    }>(sql`select tenant_id, id, client_secret_ciphertext, scopes from app.resolve_oauth_app(${clientId})`);
    const row = result.rows[0];
    if (row === undefined) {
      throw new UnauthorizedError('invalid_client', 'client_id ou client_secret inválidos.');
    }
    let decrypted: string;
    try {
      decrypted = decryptSecret(row.client_secret_ciphertext, this.config.ENCRYPTION_KEY);
    } catch {
      throw new UnauthorizedError('invalid_client', 'client_id ou client_secret inválidos.');
    }
    if (!safeEqualString(decrypted, clientSecret)) {
      throw new UnauthorizedError('invalid_client', 'client_id ou client_secret inválidos.');
    }
    const scopes = row.scopes.filter(isApiScope);
    const generated = generateApiToken();
    return this.runner.run({ tenantId: row.tenant_id, userId: null, actorKind: 'api' }, async () => {
      const [token] = await this.runner.tx
        .insert(apiTokens)
        .values({
          tenantId: row.tenant_id,
          userId: null,
          oauthAppId: row.id,
          name: `Token do app ${row.id}`,
          tokenPrefix: generated.displayPrefix,
          tokenHash: generated.tokenHash,
          scopes,
          expiresAt: new Date(Date.now() + APP_TOKEN_TTL_SECONDS * 1_000),
        })
        .returning({ id: apiTokens.id });
      if (token === undefined) throw new Error('Falha ao emitir token do app');
      return {
        accessToken: generated.token,
        tokenType: 'Bearer' as const,
        expiresIn: APP_TOKEN_TTL_SECONDS,
      };
    });
  }

  private async find(user: AuthPrincipal, appId: string): Promise<OAuthAppRow> {
    const [row] = await this.runner.tx
      .select()
      .from(oauthApps)
      .where(
        and(eq(oauthApps.id, appId), eq(oauthApps.tenantId, user.tenantId), isNull(oauthApps.deletedAt)),
      );
    if (row === undefined) throw new NotFoundError('App OAuth');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    appId: string,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'oauth_app.changed',
      aggregateType: 'oauth_app',
      aggregateId: appId,
      payload: { appId, change },
      actorId: user.userId,
    });
  }
}
