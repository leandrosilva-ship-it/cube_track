import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DatabaseHandle } from '@cube-track/db';
import { textToDoc } from '@cube-track/shared';
import { sql } from 'drizzle-orm';

import { APP_DB } from '../../../core/database/tokens.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { stripQuotedReply } from '../domain/inbound-email.js';
import { ReplyTokenService } from '../infrastructure/reply-token.js';
import { UpdatesService } from './updates.service.js';

export interface InboundEmailPayload {
  /** Destinatários (To/Cc) — o primeiro endereço `reply+…@…` reconhecido é usado. */
  to: string[];
  text: string;
}

export type InboundEmailResult =
  | { accepted: true; kind: 'update' | 'reply' }
  | { accepted: false; reason: 'address_not_recognized' | 'item_not_found' | 'empty_body' };

/**
 * Webhook de e-mail recebido (ADR 0048): resolve o endereço `reply+<token>@<domínio>` gerado pelo
 * worker nas notificações, corta a citação e grava como atualização (ou resposta, quando o token
 * referencia uma atualização específica) com `source: 'email'`. Sem contexto de tenant até resolver
 * o item via `app.resolve_item_for_reply` (SECURITY DEFINER) — por isso a transação é aberta
 * manualmente aqui, como no link público de view.
 */
@Injectable()
export class MailInboundService {
  private readonly logger = new Logger(MailInboundService.name);

  constructor(
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    private readonly runner: TransactionRunner,
    private readonly replyTokens: ReplyTokenService,
    private readonly updates: UpdatesService,
  ) {}

  async ingest(payload: InboundEmailPayload): Promise<InboundEmailResult> {
    const resolved = this.resolveAddress(payload.to);
    if (resolved === null) return { accepted: false, reason: 'address_not_recognized' };
    const bodyText = stripQuotedReply(payload.text);
    if (bodyText.length === 0) return { accepted: false, reason: 'empty_body' };
    const tenant = await this.resolveTenant(resolved.itemId, resolved.userId);
    if (tenant === null) return { accepted: false, reason: 'item_not_found' };
    const user: AuthPrincipal = {
      userId: resolved.userId,
      tenantId: tenant.tenantId,
      sessionId: 'inbound-email',
      kind: 'member',
    };
    const doc = textToDoc(bodyText);
    const kind = resolved.updateId === null ? 'update' : 'reply';
    await this.runner.run({ tenantId: tenant.tenantId, userId: resolved.userId, actorKind: 'api' }, async () => {
      if (resolved.updateId === null) {
        await this.updates.createUpdate(user, resolved.itemId, doc, 'email');
      } else {
        await this.updates.createReply(user, resolved.updateId, doc, 'email');
      }
    });
    this.logger.log({ itemId: resolved.itemId, kind }, 'Resposta por e-mail registrada');
    return { accepted: true, kind };
  }

  private resolveAddress(
    recipients: string[],
  ): { itemId: string; userId: string; updateId: string | null } | null {
    for (const recipient of recipients) {
      const match = /<([^>]+)>/.exec(recipient);
      const address = match?.[1] ?? recipient;
      const payload = this.replyTokens.parse(address);
      if (payload !== null) return payload;
    }
    return null;
  }

  private async resolveTenant(
    itemId: string,
    userId: string,
  ): Promise<{ tenantId: string; boardId: string } | null> {
    const result = await this.database.db.execute<{ tenant_id: string; board_id: string }>(
      sql`select tenant_id, board_id from app.resolve_item_for_reply(${itemId}::uuid, ${userId}::uuid)`,
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { tenantId: row.tenant_id, boardId: row.board_id };
  }
}
