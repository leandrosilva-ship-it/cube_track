import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  expandScopes,
  generateApiToken,
  isApiScope,
  type ApiScope,
} from '@cube-track/shared/api-access';
import { and, desc, eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { apiTokens, users } = schema;

type ApiTokenRow = typeof apiTokens.$inferSelect;

export interface ApiTokenDto {
  id: string;
  userId: string | null;
  userName: string | null;
  oauthAppId: string | null;
  name: string;
  tokenPrefix: string;
  scopes: ApiScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateApiTokenInput {
  name: string;
  scopes: ApiScope[];
  expiresAt?: string | null | undefined;
}

function toDto(row: ApiTokenRow, userName: string | null = null): ApiTokenDto {
  return {
    id: row.id,
    userId: row.userId,
    userName,
    oauthAppId: row.oauthAppId,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes.filter(isApiScope),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
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
 * Tokens de API pessoais (ADR 0056): autosserviço, sem permissão especial — o próprio usuário cria/
 * lista/revoga o seu, igual a trocar a própria senha. O token em texto simples só aparece na
 * resposta de criação; a partir daí só prefixo + metadados. Um token nunca autentica a criação ou
 * revogação de outro token — evita que um token minerado mine infinitos outros.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  private assertSession(user: AuthPrincipal): void {
    if (user.authKind === 'api_token') {
      throw new ForbiddenError(
        'Gerencie tokens de API com uma sessão de login, não com outro token de API.',
        'api_token_cannot_manage_tokens',
      );
    }
  }

  async listOwn(user: AuthPrincipal): Promise<ApiTokenDto[]> {
    this.assertSession(user);
    const rows = await this.runner.tx
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.tenantId, user.tenantId), eq(apiTokens.userId, user.userId)))
      .orderBy(desc(apiTokens.createdAt));
    return rows.map((row) => toDto(row, null));
  }

  async createOwn(
    user: AuthPrincipal,
    input: CreateApiTokenInput,
  ): Promise<ApiTokenDto & { token: string }> {
    this.assertSession(user);
    assertValidScopes(input.scopes);
    const expiresAt = parseExpiresAt(input.expiresAt);
    const generated = generateApiToken();
    const [row] = await this.runner.tx
      .insert(apiTokens)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        oauthAppId: null,
        name: input.name,
        tokenPrefix: generated.displayPrefix,
        tokenHash: generated.tokenHash,
        scopes: [...expandScopes(input.scopes)],
        expiresAt,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar token de API');
    this.events.recordChange({
      action: 'api_token.created',
      entityType: 'api_token',
      entityId: row.id,
      after: { name: row.name, scopes: row.scopes },
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'api_token.changed',
      aggregateType: 'api_token',
      aggregateId: row.id,
      payload: { tokenId: row.id, userId: user.userId, change: 'created' },
      actorId: user.userId,
    });
    return { ...toDto(row), token: generated.token };
  }

  async revokeOwn(user: AuthPrincipal, tokenId: string): Promise<void> {
    this.assertSession(user);
    const [row] = await this.runner.tx
      .select()
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.id, tokenId),
          eq(apiTokens.tenantId, user.tenantId),
          eq(apiTokens.userId, user.userId),
        ),
      );
    if (row === undefined) throw new NotFoundError('Token de API');
    await this.revoke(user, row);
  }

  /** Lista todos os tokens do tenant (pessoais e de apps OAuth) — requer `api_tokens.manage`. */
  async listAll(user: AuthPrincipal): Promise<ApiTokenDto[]> {
    await this.access.assert(user, 'api_tokens.manage', { type: 'tenant' });
    const rows = await this.runner.tx
      .select({ token: apiTokens, userName: users.name })
      .from(apiTokens)
      .leftJoin(users, eq(users.id, apiTokens.userId))
      .where(eq(apiTokens.tenantId, user.tenantId))
      .orderBy(desc(apiTokens.createdAt));
    return rows.map(({ token, userName }) => toDto(token, userName ?? null));
  }

  async revokeAny(user: AuthPrincipal, tokenId: string): Promise<void> {
    await this.access.assert(user, 'api_tokens.manage', { type: 'tenant' });
    const [row] = await this.runner.tx
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.tenantId, user.tenantId)));
    if (row === undefined) throw new NotFoundError('Token de API');
    await this.revoke(user, row);
  }

  private async revoke(user: AuthPrincipal, row: ApiTokenRow): Promise<void> {
    if (row.revokedAt !== null) return;
    await this.runner.tx
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(apiTokens.id, row.id));
    this.events.recordChange({
      action: 'api_token.revoked',
      entityType: 'api_token',
      entityId: row.id,
      before: { revokedAt: null },
      after: { revokedAt: new Date().toISOString() },
    });
    // `api_token.changed` é por usuário (sincroniza a lista "meus tokens" entre abas/dispositivos) —
    // um token de app OAuth (`userId` nulo) não tem destinatário desse tipo; a auditoria acima já
    // registra a revogação de qualquer forma.
    if (row.userId !== null) {
      await this.events.emit({
        tenantId: user.tenantId,
        type: 'api_token.changed',
        aggregateType: 'api_token',
        aggregateId: row.id,
        payload: { tokenId: row.id, userId: row.userId, change: 'revoked' },
        actorId: user.userId,
      });
    }
  }
}

function parseExpiresAt(value: string | null | undefined): Date | null {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new ValidationError([{ path: 'body.expiresAt', message: 'Data inválida.' }]);
  if (date.getTime() <= Date.now())
    throw new ValidationError([
      { path: 'body.expiresAt', message: 'A expiração deve ser no futuro.' },
    ]);
  return date;
}
