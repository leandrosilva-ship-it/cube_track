import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { hashPassword } from '../../../core/crypto/password.js';
import { randomToken, sha256Hex } from '../../../core/crypto/secrets.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { views, shareLinks } = schema;

export interface ShareLinkSettings {
  hiddenColumnKeys: string[];
  allowSearch: boolean;
}

const DEFAULT_SETTINGS: ShareLinkSettings = { hiddenColumnKeys: [], allowSearch: true };

export interface UpsertShareLinkInput {
  /** `null` remove a senha; ausente mantém a atual. */
  password?: string | null | undefined;
  /** `null` remove a expiração; ausente mantém a atual. */
  expiresAt?: string | null | undefined;
  hiddenColumnKeys?: string[] | undefined;
  allowSearch?: boolean | undefined;
  regenerateToken?: boolean | undefined;
}

export interface ShareLinkStatus {
  exists: boolean;
  requiresPassword?: boolean;
  expiresAt?: string | null;
  revokedAt?: string | null;
  accessCount?: number;
  lastAccessedAt?: string | null;
  settings?: ShareLinkSettings;
}

export interface ShareLinkResult {
  /** Token em claro — só presente logo após criar/regenerar (nunca mais recuperável depois). */
  token: string | null;
  path: string;
  requiresPassword: boolean;
  expiresAt: string | null;
  settings: ShareLinkSettings;
}

interface ShareLinkRow {
  id: string;
  passwordHash: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  accessCount: number;
  lastAccessedAt: Date | null;
  settings: Record<string, unknown>;
}

function toSettings(raw: Record<string, unknown> | null | undefined): ShareLinkSettings {
  const hiddenColumnKeys = Array.isArray(raw?.hiddenColumnKeys)
    ? (raw.hiddenColumnKeys as unknown[]).filter((key): key is string => typeof key === 'string')
    : DEFAULT_SETTINGS.hiddenColumnKeys;
  const allowSearch =
    typeof raw?.allowSearch === 'boolean' ? raw.allowSearch : DEFAULT_SETTINGS.allowSearch;
  return { hiddenColumnKeys, allowSearch };
}

/**
 * Link público somente leitura de uma view (ADR 0047): token opaco (hash armazenado, nunca o
 * valor em claro), senha (Argon2id) e expiração opcionais. Gerenciado por quem tem `board.share`.
 */
@Injectable()
export class ShareLinksService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly domainEvents: DomainEvents,
  ) {}

  async status(user: AuthPrincipal, viewId: string): Promise<ShareLinkStatus> {
    const view = await this.manageableView(user, viewId);
    const link = await this.findLink(view.id);
    if (link === undefined) return { exists: false };
    return {
      exists: true,
      requiresPassword: link.passwordHash !== null,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      revokedAt: link.revokedAt?.toISOString() ?? null,
      accessCount: link.accessCount,
      lastAccessedAt: link.lastAccessedAt?.toISOString() ?? null,
      settings: toSettings(link.settings),
    };
  }

  async upsert(
    user: AuthPrincipal,
    viewId: string,
    input: UpsertShareLinkInput,
  ): Promise<ShareLinkResult> {
    const view = await this.manageableView(user, viewId);
    const tx = this.runner.tx;
    const existing = await this.findLink(view.id);
    const currentSettings = toSettings(existing?.settings);
    const settings: ShareLinkSettings = {
      hiddenColumnKeys: input.hiddenColumnKeys ?? currentSettings.hiddenColumnKeys,
      allowSearch: input.allowSearch ?? currentSettings.allowSearch,
    };
    const expiresAt =
      input.expiresAt === undefined
        ? (existing?.expiresAt ?? null)
        : input.expiresAt === null
          ? null
          : new Date(input.expiresAt);
    const passwordHash =
      input.password === undefined
        ? (existing?.passwordHash ?? null)
        : input.password === null
          ? null
          : await hashPassword(input.password);
    const regenerate = input.regenerateToken === true || existing === undefined;
    const token = regenerate ? randomToken() : null;
    const tokenHash = regenerate && token !== null ? sha256Hex(token) : undefined;

    if (existing === undefined) {
      if (tokenHash === undefined) throw new Error('Token obrigatório ao criar o link.');
      await tx.insert(shareLinks).values({
        tenantId: user.tenantId,
        resourceType: 'view',
        resourceId: view.id,
        tokenHash,
        passwordHash,
        expiresAt,
        settings: settings as unknown as Record<string, unknown>,
        createdBy: user.userId,
      });
    } else {
      await tx
        .update(shareLinks)
        .set({
          ...(tokenHash === undefined ? {} : { tokenHash }),
          passwordHash,
          expiresAt,
          settings: settings as unknown as Record<string, unknown>,
          revokedAt: null,
        })
        .where(eq(shareLinks.id, existing.id));
    }
    this.domainEvents.recordChange({
      action: existing === undefined ? 'share_link.create' : 'share_link.update',
      entityType: 'share_link',
      entityId: existing?.id ?? null,
      boardId: view.boardId,
      after: { viewId: view.id, hasPassword: passwordHash !== null, regenerated: regenerate },
    });
    return {
      token,
      path: token === null ? '/public/share' : `/public/share/${token}`,
      requiresPassword: passwordHash !== null,
      expiresAt: expiresAt?.toISOString() ?? null,
      settings,
    };
  }

  async revoke(user: AuthPrincipal, viewId: string): Promise<void> {
    const view = await this.manageableView(user, viewId);
    const existing = await this.findLink(view.id);
    if (existing === undefined) throw new NotFoundError('Link público');
    await this.runner.tx
      .update(shareLinks)
      .set({ revokedAt: new Date() })
      .where(eq(shareLinks.id, existing.id));
    this.domainEvents.recordChange({
      action: 'share_link.revoke',
      entityType: 'share_link',
      entityId: existing.id,
      boardId: view.boardId,
    });
  }

  private async manageableView(user: AuthPrincipal, viewId: string) {
    const [view] = await this.runner.tx
      .select({ id: views.id, boardId: views.boardId })
      .from(views)
      .where(and(eq(views.id, viewId), isNull(views.deletedAt)));
    if (view === undefined) throw new NotFoundError('View');
    await this.access.assert(user, 'board.share', { type: 'board', id: view.boardId }, 'View');
    return view;
  }

  private async findLink(viewId: string): Promise<ShareLinkRow | undefined> {
    const [link] = await this.runner.tx
      .select({
        id: shareLinks.id,
        passwordHash: shareLinks.passwordHash,
        expiresAt: shareLinks.expiresAt,
        revokedAt: shareLinks.revokedAt,
        accessCount: shareLinks.accessCount,
        lastAccessedAt: shareLinks.lastAccessedAt,
        settings: shareLinks.settings,
      })
      .from(shareLinks)
      .where(and(eq(shareLinks.resourceType, 'view'), eq(shareLinks.resourceId, viewId)));
    return link;
  }
}
