import { Inject, Injectable } from '@nestjs/common';
import { schema, type DatabaseHandle } from '@cube-track/db';
import { and, asc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';

import { APP_DB } from '../../../core/database/tokens.js';
import { verifyPassword } from '../../../core/crypto/password.js';
import { sha256Hex } from '../../../core/crypto/secrets.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnauthorizedError } from '../../../core/errors/problems.js';
import {
  ShareSessionService,
  SHARE_SESSION_TTL_SECONDS,
  type VerifiedShareSession,
} from '../infrastructure/share-session.service.js';
import { type ShareLinkSettings } from './share-links.service.js';

const { boards, columnDefinitions, dropdownOptions, groups, items, shareLinks, statusLabels, views } =
  schema;

const PUBLIC_ITEMS_LIMIT = 1_000;

interface ResolvedShareLink {
  tenantId: string;
  shareLinkId: string;
  resourceType: string;
  resourceId: string;
  requiresPassword: boolean;
}

export interface PublicVerifyResult {
  shareToken: string;
  boardId: string;
  viewId: string;
  expiresInSeconds: number;
}

function toSettings(raw: Record<string, unknown> | null | undefined): ShareLinkSettings {
  const hiddenColumnKeys = Array.isArray(raw?.hiddenColumnKeys)
    ? (raw.hiddenColumnKeys as unknown[]).filter((key): key is string => typeof key === 'string')
    : [];
  const allowSearch = typeof raw?.allowSearch === 'boolean' ? raw.allowSearch : true;
  return { hiddenColumnKeys, allowSearch };
}

/**
 * Leitura pública (sem autenticação) de uma view compartilhada por link (ADR 0047). O token nunca
 * é persistido em claro: resolvido via `app.resolve_share_link` (SECURITY DEFINER, sem contexto de
 * tenant), depois as leituras seguem com `TransactionRunner.run({ userId: null, actorKind: 'api' })`.
 */
@Injectable()
export class PublicShareService {
  constructor(
    @Inject(APP_DB) private readonly database: DatabaseHandle,
    private readonly runner: TransactionRunner,
    private readonly shareSessions: ShareSessionService,
  ) {}

  async info(token: string): Promise<{ requiresPassword: boolean }> {
    const resolved = await this.resolve(token);
    return { requiresPassword: resolved.requiresPassword };
  }

  async verify(token: string, password: string | undefined): Promise<PublicVerifyResult> {
    const resolved = await this.resolve(token);
    if (resolved.resourceType !== 'view') {
      throw new UnauthorizedError('share_link_invalid', 'Link inválido, expirado ou revogado.');
    }
    const found = await this.runner.run(
      { tenantId: resolved.tenantId, userId: null, actorKind: 'api' },
      async () => {
        const [link] = await this.runner.tx
          .select({ id: shareLinks.id, passwordHash: shareLinks.passwordHash })
          .from(shareLinks)
          .where(eq(shareLinks.id, resolved.shareLinkId));
        const [view] = await this.runner.tx
          .select({ id: views.id, boardId: views.boardId })
          .from(views)
          .where(and(eq(views.id, resolved.resourceId), isNull(views.deletedAt)));
        return { link, view };
      },
      { readOnly: true },
    );
    if (found.link === undefined || found.view === undefined) {
      throw new UnauthorizedError('share_link_invalid', 'Link inválido, expirado ou revogado.');
    }
    if (resolved.requiresPassword) {
      const ok = await verifyPassword(found.link.passwordHash, password ?? '');
      if (!ok) throw new UnauthorizedError('share_link_invalid', 'Senha incorreta.');
    }
    const shareToken = await this.shareSessions.sign({
      shareLinkId: resolved.shareLinkId,
      tenantId: resolved.tenantId,
      viewId: found.view.id,
      boardId: found.view.boardId,
    });
    await this.runner.run({ tenantId: resolved.tenantId, userId: null, actorKind: 'api' }, async () => {
      await this.runner.tx
        .update(shareLinks)
        .set({ accessCount: sql`${shareLinks.accessCount} + 1`, lastAccessedAt: new Date() })
        .where(eq(shareLinks.id, resolved.shareLinkId));
    });
    return {
      shareToken,
      boardId: found.view.boardId,
      viewId: found.view.id,
      expiresInSeconds: SHARE_SESSION_TTL_SECONDS,
    };
  }

  async board(session: VerifiedShareSession) {
    return this.runner.run(
      { tenantId: session.tenantId, userId: null, actorKind: 'api' },
      async () => {
        const [view] = await this.runner.tx
          .select({ id: views.id, name: views.name, type: views.type, hiddenColumnKeys: views.hiddenColumnKeys })
          .from(views)
          .where(and(eq(views.id, session.viewId), isNull(views.deletedAt)));
        if (view === undefined) throw new NotFoundError('View');
        const [board] = await this.runner.tx
          .select({ name: boards.name, description: boards.description, icon: boards.icon })
          .from(boards)
          .where(and(eq(boards.id, session.boardId), isNull(boards.deletedAt)));
        if (board === undefined) throw new NotFoundError('Board');
        const [link] = await this.runner.tx
          .select({ settings: shareLinks.settings })
          .from(shareLinks)
          .where(eq(shareLinks.id, session.shareLinkId));
        const hidden = new Set([
          ...view.hiddenColumnKeys,
          ...toSettings(link?.settings).hiddenColumnKeys,
        ]);
        const groupRows = await this.runner.tx
          .select({ id: groups.id, name: groups.name, color: groups.color, position: groups.position })
          .from(groups)
          .where(and(eq(groups.boardId, session.boardId), isNull(groups.deletedAt)))
          .orderBy(asc(groups.position));
        const columnRows = await this.runner.tx
          .select({
            id: columnDefinitions.id,
            key: columnDefinitions.key,
            type: columnDefinitions.type,
            title: columnDefinitions.title,
            binding: columnDefinitions.binding,
            width: columnDefinitions.width,
          })
          .from(columnDefinitions)
          .where(
            and(
              eq(columnDefinitions.boardId, session.boardId),
              eq(columnDefinitions.isHidden, false),
              isNull(columnDefinitions.deletedAt),
            ),
          )
          .orderBy(asc(columnDefinitions.position));
        const visibleColumns = columnRows.filter((column) => !hidden.has(column.key));
        const columnIds = visibleColumns.map((column) => column.id);
        const [labelRows, optionRows] = await Promise.all([
          columnIds.length === 0
            ? Promise.resolve([])
            : this.runner.tx
                .select({
                  id: statusLabels.id,
                  columnId: statusLabels.columnId,
                  label: statusLabels.label,
                  color: statusLabels.color,
                  category: statusLabels.category,
                  position: statusLabels.position,
                })
                .from(statusLabels)
                .where(and(inArray(statusLabels.columnId, columnIds), isNull(statusLabels.deletedAt)))
                .orderBy(asc(statusLabels.position)),
          columnIds.length === 0
            ? Promise.resolve([])
            : this.runner.tx
                .select({
                  id: dropdownOptions.id,
                  columnId: dropdownOptions.columnId,
                  label: dropdownOptions.label,
                  color: dropdownOptions.color,
                  position: dropdownOptions.position,
                })
                .from(dropdownOptions)
                .where(
                  and(inArray(dropdownOptions.columnId, columnIds), isNull(dropdownOptions.deletedAt)),
                )
                .orderBy(asc(dropdownOptions.position)),
        ]);
        return {
          name: board.name,
          description: board.description,
          icon: board.icon,
          viewType: view.type,
          viewName: view.name,
          groups: groupRows,
          columns: visibleColumns.map((column) => ({
            ...column,
            labels: labelRows.filter((label) => label.columnId === column.id),
            options: optionRows.filter((option) => option.columnId === column.id),
          })),
        };
      },
      { readOnly: true },
    );
  }

  async items(session: VerifiedShareSession, search: string | undefined) {
    return this.runner.run(
      { tenantId: session.tenantId, userId: null, actorKind: 'api' },
      async () => {
        const [view] = await this.runner.tx
          .select({ id: views.id, hiddenColumnKeys: views.hiddenColumnKeys })
          .from(views)
          .where(and(eq(views.id, session.viewId), isNull(views.deletedAt)));
        if (view === undefined) throw new NotFoundError('View');
        const [link] = await this.runner.tx
          .select({ settings: shareLinks.settings })
          .from(shareLinks)
          .where(eq(shareLinks.id, session.shareLinkId));
        const settings = toSettings(link?.settings);
        const hidden = new Set([...view.hiddenColumnKeys, ...settings.hiddenColumnKeys]);
        const query = search !== undefined && search.trim() !== '' && settings.allowSearch;
        const rows = await this.runner.tx
          .select({ id: items.id, groupId: items.groupId, name: items.name, position: items.position, values: items.values })
          .from(items)
          .where(
            and(
              eq(items.boardId, session.boardId),
              isNull(items.parentItemId),
              isNull(items.archivedAt),
              isNull(items.deletedAt),
              query ? ilike(items.name, `%${search.trim()}%`) : undefined,
            ),
          )
          .orderBy(asc(items.groupId), asc(items.position))
          .limit(PUBLIC_ITEMS_LIMIT + 1);
        const truncated = rows.length > PUBLIC_ITEMS_LIMIT;
        const page = truncated ? rows.slice(0, PUBLIC_ITEMS_LIMIT) : rows;
        return {
          data: page.map((row) => ({
            ...row,
            values: Object.fromEntries(
              Object.entries(row.values).filter(([key]) => !hidden.has(key)),
            ),
          })),
          truncated,
        };
      },
      { readOnly: true },
    );
  }

  private async resolve(token: string): Promise<ResolvedShareLink> {
    const result = await this.database.db.execute<{
      tenant_id: string;
      share_link_id: string;
      resource_type: string;
      resource_id: string;
      requires_password: boolean;
    }>(sql`select tenant_id, share_link_id, resource_type, resource_id, requires_password
           from app.resolve_share_link(${sha256Hex(token)})`);
    const row = result.rows[0];
    if (row === undefined) {
      throw new UnauthorizedError('share_link_invalid', 'Link inválido, expirado ou revogado.');
    }
    return {
      tenantId: row.tenant_id,
      shareLinkId: row.share_link_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      requiresPassword: row.requires_password,
    };
  }
}
