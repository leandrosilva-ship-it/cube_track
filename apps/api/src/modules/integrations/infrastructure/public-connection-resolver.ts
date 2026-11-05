import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseHandle } from '@cube-track/db';
import { sql } from 'drizzle-orm';

import { APP_DB } from '../../../core/database/tokens.js';

export interface ResolvedConnection {
  tenantId: string;
  id: string;
  workspaceId: string;
  provider: string;
  authKind: 'oauth' | 'webhook_secret';
  userId: string | null;
  accessTokenCiphertext: string | null;
  refreshTokenCiphertext: string | null;
  tokenExpiresAt: Date | null;
  webhookSecretCiphertext: string | null;
  outboundWebhookUrlCiphertext: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Resolve uma `integration_connections` por id SEM contexto de tenant (ADR 0056) — os webhooks de
 * entrada (GitHub/GitLab/Azure DevOps/Slack) e o callback OAuth (Google/Microsoft) recebem só um id de
 * conexão na URL/estado, nenhuma sessão. Usa `app.resolve_integration_connection` (SECURITY DEFINER,
 * migração 0031), mesmo padrão de `app.resolve_oauth_app` (ADR 0056, API pública).
 */
@Injectable()
export class PublicConnectionResolver {
  constructor(@Inject(APP_DB) private readonly database: DatabaseHandle) {}

  async resolve(connectionId: string): Promise<ResolvedConnection | null> {
    const result = await this.database.db.execute<{
      tenant_id: string;
      id: string;
      workspace_id: string;
      provider: string;
      auth_kind: string;
      user_id: string | null;
      access_token_ciphertext: string | null;
      refresh_token_ciphertext: string | null;
      token_expires_at: Date | null;
      webhook_secret_ciphertext: string | null;
      outbound_webhook_url_ciphertext: string | null;
      metadata: Record<string, unknown>;
    }>(sql`select * from app.resolve_integration_connection(${connectionId})`);
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      tenantId: row.tenant_id,
      id: row.id,
      workspaceId: row.workspace_id,
      provider: row.provider,
      authKind: row.auth_kind === 'oauth' ? 'oauth' : 'webhook_secret',
      userId: row.user_id,
      accessTokenCiphertext: row.access_token_ciphertext,
      refreshTokenCiphertext: row.refresh_token_ciphertext,
      tokenExpiresAt: row.token_expires_at,
      webhookSecretCiphertext: row.webhook_secret_ciphertext,
      outboundWebhookUrlCiphertext: row.outbound_webhook_url_ciphertext,
      metadata: row.metadata,
    };
  }
}
