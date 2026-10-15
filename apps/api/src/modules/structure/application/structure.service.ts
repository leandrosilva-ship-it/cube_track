import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { boardTemplates, newId, type BoardTemplate } from '@cube-track/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { BoardBlueprintWriter } from './board-blueprint.js';
import {
  createsCycle,
  normalizeLocale,
  positionAmong,
  type SupportedLocale,
} from '../domain/structure.js';

const { workspaces, folders, boards, views, favorites, roles, accessGrants, tenants } = schema;

export interface Neighbors {
  afterId?: string | null | undefined;
  beforeId?: string | null | undefined;
}

export interface CreateWorkspaceInput {
  name: string;
  description?: string | undefined;
  color?: string | undefined;
}

export interface CreateFolderInput {
  name: string;
  parentId?: string | null | undefined;
  color?: string | undefined;
}

export interface UpdateFolderInput extends Neighbors {
  name?: string | undefined;
  color?: string | null | undefined;
  /** `undefined` = mantém o pai; `null` = raiz do workspace. */
  parentId?: string | null | undefined;
}

export type BoardTemplateInput =
  | { kind: 'builtin'; key: string }
  | { kind: 'board'; boardId: string; includeItems?: boolean | undefined };

export interface CreateBoardInput {
  name: string;
  description?: string | undefined;
  icon?: string | null | undefined;
  folderId?: string | null | undefined;
  kind?: 'board' | 'project' | 'process' | 'backlog' | undefined;
  visibility?: 'main' | 'private' | 'shareable' | undefined;
  template?: BoardTemplateInput | undefined;
}

export interface UpdateBoardInput extends Neighbors {
  name?: string | undefined;
  description?: string | null | undefined;
  icon?: string | null | undefined;
  visibility?: 'main' | 'private' | 'shareable' | undefined;
  isTemplate?: boolean | undefined;
  folderId?: string | null | undefined;
}

export type ViewType = (typeof views.$inferSelect)['type'];

export interface CreateViewInput {
  name: string;
  type: ViewType;
  personal?: boolean | undefined;
}

export interface UpdateViewInput extends Neighbors {
  name?: string | undefined;
}

export type FavoriteType = 'workspace' | 'folder' | 'board';

const BOARD_SUMMARY = {
  id: boards.id,
  workspaceId: boards.workspaceId,
  folderId: boards.folderId,
  kind: boards.kind,
  name: boards.name,
  description: boards.description,
  visibility: boards.visibility,
  position: boards.position,
};

const VIEW_SUMMARY = {
  id: views.id,
  boardId: views.boardId,
  name: views.name,
  type: views.type,
  ownerId: views.ownerId,
  isDefault: views.isDefault,
  isLocked: views.isLocked,
  isRestricted: views.isRestricted,
  position: views.position,
};

/**
 * Estrutura de navegação: workspaces, árvore de pastas e boards, favoritos e views. Leituras são
 * filtradas por permissão; escritas gravam auditoria e emitem eventos só com ids (os clientes
 * recarregam a parte afetada já filtrada para cada usuário).
 */
@Injectable()
export class StructureService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly domainEvents: DomainEvents,
    private readonly blueprints: BoardBlueprintWriter,
  ) {}

  // ------------------------------------------------------------------------ Templates ---

  /** Templates disponíveis: embutidos (idioma do tenant) e boards marcados como template. */
  async templates(user: AuthPrincipal) {
    const [tenant] = await this.runner.tx
      .select({ locale: tenants.locale })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId));
    const builtin = boardTemplates(normalizeLocale(tenant?.locale)).map((template) => ({
      kind: 'builtin' as const,
      key: template.key,
      name: template.name,
      description: template.description,
      icon: template.icon,
      boardKind: template.kind,
      groups: template.groups.map((group) => group.name),
      columns: template.columns.map((column) => ({ title: column.title, type: column.type })),
    }));
    const rows = await this.runner.tx
      .select({
        id: boards.id,
        name: boards.name,
        description: boards.description,
        icon: boards.icon,
        kind: boards.kind,
      })
      .from(boards)
      .where(and(eq(boards.isTemplate, true), isNull(boards.deletedAt)))
      .orderBy(asc(boards.name));
    const readable = await Promise.all(
      rows.map(async (row) => ((await this.access.board(user, row.id)) === null ? null : row)),
    );
    return {
      builtin,
      boards: readable
        .filter((row) => row !== null)
        .map((row) => ({
          kind: 'board' as const,
          boardId: row.id,
          name: row.name,
          description: row.description,
          icon: row.icon,
          boardKind: row.kind,
        })),
    };
  }

  private async resolveTemplate(
    user: AuthPrincipal,
    input: BoardTemplateInput | undefined,
    locale: SupportedLocale,
  ): Promise<
    | { kind: 'builtin'; blueprint: BoardTemplate }
    | { kind: 'board'; boardId: string; includeItems: boolean }
  > {
    const catalog = boardTemplates(locale);
    if (input === undefined || input.kind === 'builtin') {
      const key = input?.key ?? 'blank';
      const blueprint = catalog.find((template) => template.key === key);
      if (blueprint === undefined)
        throw new ValidationError([
          { path: 'body.template.key', message: 'Template inexistente.' },
        ]);
      return { kind: 'builtin', blueprint };
    }
    await this.access.assert(user, 'board.read', { type: 'board', id: input.boardId }, 'Template');
    const [source] = await this.runner.tx
      .select({ isTemplate: boards.isTemplate })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), isNull(boards.deletedAt)));
    if (source?.isTemplate !== true)
      throw new ValidationError([
        { path: 'body.template.boardId', message: 'O board não é um template.' },
      ]);
    return { kind: 'board', boardId: input.boardId, includeItems: input.includeItems ?? false };
  }

  // ------------------------------------------------------------------------ Workspaces ---

  async createWorkspace(user: AuthPrincipal, input: CreateWorkspaceInput) {
    await this.access.assert(user, 'workspace.create', { type: 'tenant' });
    const tx = this.runner.tx;
    const siblings = await tx
      .select({ id: workspaces.id, position: workspaces.position })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt));
    const id = newId();
    const [created] = await tx
      .insert(workspaces)
      .values({
        id,
        tenantId: user.tenantId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        position: positionAmong(siblings, {}),
        createdBy: user.userId,
      })
      .returning({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        icon: workspaces.icon,
        color: workspaces.color,
        visibility: workspaces.visibility,
        enabledModules: workspaces.enabledModules,
      });
    if (created === undefined) throw new Error('Falha ao criar workspace');
    await this.grant(user, 'workspace', id, 'workspace', 'workspace_admin');
    this.domainEvents.recordChange({
      action: 'workspace.create',
      entityType: 'workspace',
      entityId: id,
      after: { name: input.name },
    });
    await this.structureChanged(user, id);
    return created;
  }

  // ------------------------------------------------------------------------------ Tree ---

  async tree(user: AuthPrincipal, workspaceId: string) {
    const tx = this.runner.tx;
    const workspaceAccess = await this.access.workspace(user, workspaceId);
    const boardRows = await tx
      .select(BOARD_SUMMARY)
      .from(boards)
      .where(
        and(
          eq(boards.workspaceId, workspaceId),
          isNull(boards.deletedAt),
          isNull(boards.archivedAt),
          eq(boards.isTemplate, false),
        ),
      )
      .orderBy(asc(boards.position));
    const readable = (
      await Promise.all(
        boardRows.map(async (row) =>
          (await this.access.board(user, row.id)) === null ? null : row,
        ),
      )
    ).filter((row) => row !== null);
    // Convidados sem leitura do workspace enxergam apenas os boards concedidos (na raiz).
    if (workspaceAccess === null && readable.length === 0) throw new NotFoundError('Workspace');
    const folderRows =
      workspaceAccess === null
        ? []
        : await tx
            .select({
              id: folders.id,
              parentId: folders.parentId,
              name: folders.name,
              color: folders.color,
              position: folders.position,
            })
            .from(folders)
            .where(and(eq(folders.workspaceId, workspaceId), isNull(folders.deletedAt)))
            .orderBy(asc(folders.position));
    const folderIds = new Set(folderRows.map((folder) => folder.id));
    const permissions = workspaceAccess?.permissions ?? [];
    return {
      workspaceId,
      canManageFolders: permissions.includes('folder.manage'),
      canCreateBoards: permissions.includes('board.create'),
      folders: folderRows,
      boards: readable.map((board) => ({
        ...board,
        folderId: board.folderId !== null && folderIds.has(board.folderId) ? board.folderId : null,
      })),
    };
  }

  // --------------------------------------------------------------------------- Folders ---

  async createFolder(user: AuthPrincipal, workspaceId: string, input: CreateFolderInput) {
    await this.access.assert(
      user,
      'folder.manage',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    const parentId = input.parentId ?? null;
    const all = await this.foldersOf(workspaceId);
    if (parentId !== null && !all.some((folder) => folder.id === parentId)) {
      throw new ValidationError([{ path: 'body.parentId', message: 'Pasta não encontrada.' }]);
    }
    const id = newId();
    const position = positionAmong(
      all.filter((folder) => folder.parentId === parentId),
      {},
    );
    await this.runner.tx.insert(folders).values({
      id,
      tenantId: user.tenantId,
      workspaceId,
      parentId,
      name: input.name,
      color: input.color ?? null,
      position,
      createdBy: user.userId,
    });
    this.domainEvents.recordChange({
      action: 'folder.create',
      entityType: 'folder',
      entityId: id,
      after: { name: input.name, parentId, workspaceId },
    });
    await this.structureChanged(user, workspaceId);
    return { id, workspaceId, parentId, name: input.name, color: input.color ?? null, position };
  }

  async updateFolder(user: AuthPrincipal, folderId: string, input: UpdateFolderInput) {
    const folder = await this.folder(folderId);
    await this.access.assert(
      user,
      'folder.manage',
      { type: 'workspace', id: folder.workspaceId },
      'Pasta',
    );
    const set: Partial<typeof folders.$inferInsert> = {};
    const before: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== folder.name) {
      before.name = folder.name;
      set.name = input.name;
    }
    if (input.color !== undefined && input.color !== folder.color) {
      before.color = folder.color;
      set.color = input.color;
    }
    const moving =
      input.parentId !== undefined || input.afterId !== undefined || input.beforeId !== undefined;
    if (moving) {
      const all = await this.foldersOf(folder.workspaceId);
      const parentId = input.parentId === undefined ? folder.parentId : input.parentId;
      if (parentId !== null && !all.some((entry) => entry.id === parentId)) {
        throw new ValidationError([{ path: 'body.parentId', message: 'Pasta não encontrada.' }]);
      }
      if (createsCycle(all, folder.id, parentId)) {
        throw new ValidationError([
          { path: 'body.parentId', message: 'Uma pasta não pode ficar dentro dela mesma.' },
        ]);
      }
      before.parentId = folder.parentId;
      before.position = folder.position;
      set.parentId = parentId;
      set.position = this.place(
        all.filter((entry) => entry.parentId === parentId && entry.id !== folder.id),
        input,
      );
    }
    if (Object.keys(set).length === 0) return { id: folderId, changes: {} };
    await this.runner.tx.update(folders).set(set).where(eq(folders.id, folderId));
    this.domainEvents.recordChange({
      action: 'folder.update',
      entityType: 'folder',
      entityId: folderId,
      before,
      after: set,
    });
    await this.structureChanged(user, folder.workspaceId);
    return { id: folderId, changes: set };
  }

  /** Exclui a pasta (lixeira); subpastas e boards sobem para o pai da pasta excluída. */
  async deleteFolder(user: AuthPrincipal, folderId: string): Promise<void> {
    const folder = await this.folder(folderId);
    await this.access.assert(
      user,
      'folder.manage',
      { type: 'workspace', id: folder.workspaceId },
      'Pasta',
    );
    const tx = this.runner.tx;
    await tx
      .update(folders)
      .set({ parentId: folder.parentId })
      .where(and(eq(folders.parentId, folderId), isNull(folders.deletedAt)));
    await tx.update(boards).set({ folderId: folder.parentId }).where(eq(boards.folderId, folderId));
    await tx.update(folders).set({ deletedAt: new Date() }).where(eq(folders.id, folderId));
    this.domainEvents.recordChange({
      action: 'folder.delete',
      entityType: 'folder',
      entityId: folderId,
      before: { name: folder.name, parentId: folder.parentId },
    });
    await this.structureChanged(user, folder.workspaceId);
  }

  // ---------------------------------------------------------------------------- Boards ---

  async createBoard(user: AuthPrincipal, workspaceId: string, input: CreateBoardInput) {
    await this.access.assert(
      user,
      'board.create',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    const tx = this.runner.tx;
    const folderId = input.folderId ?? null;
    if (folderId !== null) {
      const all = await this.foldersOf(workspaceId);
      if (!all.some((folder) => folder.id === folderId)) {
        throw new ValidationError([{ path: 'body.folderId', message: 'Pasta não encontrada.' }]);
      }
    }
    const siblings = await this.boardsIn(workspaceId, folderId);
    const [tenant] = await tx
      .select({ locale: tenants.locale })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId));
    const template = await this.resolveTemplate(
      user,
      input.template,
      normalizeLocale(tenant?.locale),
    );
    const boardId = newId();
    await tx.insert(boards).values({
      tenantId: user.tenantId,
      createdBy: user.userId,
      id: boardId,
      workspaceId,
      folderId,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? (template.kind === 'builtin' ? template.blueprint.icon : null),
      kind: input.kind ?? (template.kind === 'builtin' ? template.blueprint.kind : 'board'),
      visibility: input.visibility ?? 'main',
      ownerId: user.userId,
      sourceTemplateId: template.kind === 'board' ? template.boardId : null,
      position: positionAmong(siblings, {}),
    });
    if (template.kind === 'builtin')
      await this.blueprints.fromTemplate(user, boardId, template.blueprint);
    else await this.blueprints.fromBoard(user, boardId, template.boardId, template.includeItems);
    await this.grant(user, 'board', boardId, 'board', 'board_owner');
    this.domainEvents.recordChange({
      action: 'board.create',
      entityType: 'board',
      entityId: boardId,
      boardId,
      after: { name: input.name, workspaceId, folderId, kind: input.kind ?? 'board' },
    });
    await this.structureChanged(user, workspaceId);
    return {
      id: boardId,
      workspaceId,
      folderId,
      name: input.name,
      kind: input.kind ?? 'board',
      visibility: input.visibility ?? 'main',
    };
  }

  async updateBoard(user: AuthPrincipal, boardId: string, input: UpdateBoardInput) {
    const tx = this.runner.tx;
    const [board] = await tx
      .select(BOARD_SUMMARY)
      .from(boards)
      .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)));
    if (board === undefined) throw new NotFoundError('Board');
    const set: Partial<typeof boards.$inferInsert> = {};
    const before: Record<string, unknown> = {};
    const details: Record<string, unknown> = {};
    const managed = {
      icon: input.icon,
      visibility: input.visibility,
      isTemplate: input.isTemplate,
    } as const;
    if (Object.values(managed).some((value) => value !== undefined)) {
      await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
      const [current] = await tx
        .select({ icon: boards.icon, visibility: boards.visibility, isTemplate: boards.isTemplate })
        .from(boards)
        .where(eq(boards.id, boardId));
      for (const [key, value] of Object.entries(managed) as [keyof typeof managed, unknown][]) {
        if (value === undefined || current?.[key] === value) continue;
        before[key] = current?.[key];
        (set as Record<string, unknown>)[key] = value;
        details[key] = value;
      }
    }
    if (input.name !== undefined || input.description !== undefined) {
      await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
      if (input.name !== undefined && input.name !== board.name) {
        before.name = board.name;
        set.name = input.name;
        details.name = input.name;
      }
      if (input.description !== undefined && input.description !== board.description) {
        before.description = board.description;
        set.description = input.description;
        details.description = input.description;
      }
    }
    const moving =
      input.folderId !== undefined || input.afterId !== undefined || input.beforeId !== undefined;
    if (moving) {
      await this.access.assert(
        user,
        'folder.manage',
        { type: 'workspace', id: board.workspaceId },
        'Board',
      );
      const folderId = input.folderId === undefined ? board.folderId : input.folderId;
      if (folderId !== null) {
        const all = await this.foldersOf(board.workspaceId);
        if (!all.some((folder) => folder.id === folderId)) {
          throw new ValidationError([{ path: 'body.folderId', message: 'Pasta não encontrada.' }]);
        }
      }
      const siblings = (await this.boardsIn(board.workspaceId, folderId)).filter(
        (entry) => entry.id !== boardId,
      );
      before.folderId = board.folderId;
      before.position = board.position;
      set.folderId = folderId;
      set.position = this.place(siblings, input);
    }
    if (Object.keys(set).length === 0) return { id: boardId, changes: {} };
    await tx.update(boards).set(set).where(eq(boards.id, boardId));
    this.domainEvents.recordChange({
      action: 'board.update',
      entityType: 'board',
      entityId: boardId,
      boardId,
      before,
      after: set,
    });
    if (Object.keys(details).length > 0) {
      await this.domainEvents.emit({
        tenantId: user.tenantId,
        type: 'board.updated',
        aggregateType: 'board',
        aggregateId: boardId,
        boardId,
        payload: { boardId, changes: details },
        actorId: user.userId,
      });
    }
    await this.structureChanged(user, board.workspaceId);
    return { id: boardId, changes: set };
  }

  // ------------------------------------------------------------------------- Favorites ---

  async favorites(user: AuthPrincipal) {
    const tx = this.runner.tx;
    const rows = await tx
      .select({
        entityType: favorites.entityType,
        entityId: favorites.entityId,
        position: favorites.position,
      })
      .from(favorites)
      .where(eq(favorites.userId, user.userId))
      .orderBy(asc(favorites.position));
    const idsOf = (type: string) =>
      rows.filter((row) => row.entityType === type).map((row) => row.entityId);
    const [boardRows, workspaceRows, folderRows] = await Promise.all([
      idsOf('board').length === 0
        ? Promise.resolve([])
        : tx
            .select({ id: boards.id, name: boards.name, workspaceId: boards.workspaceId })
            .from(boards)
            .where(and(inArray(boards.id, idsOf('board')), isNull(boards.deletedAt))),
      idsOf('workspace').length === 0
        ? Promise.resolve([])
        : tx
            .select({ id: workspaces.id, name: workspaces.name, workspaceId: workspaces.id })
            .from(workspaces)
            .where(and(inArray(workspaces.id, idsOf('workspace')), isNull(workspaces.deletedAt))),
      idsOf('folder').length === 0
        ? Promise.resolve([])
        : tx
            .select({ id: folders.id, name: folders.name, workspaceId: folders.workspaceId })
            .from(folders)
            .where(and(inArray(folders.id, idsOf('folder')), isNull(folders.deletedAt))),
    ]);
    const byType: Record<string, typeof boardRows> = {
      board: boardRows,
      workspace: workspaceRows,
      folder: folderRows,
    };
    const resolved = await Promise.all(
      rows.map(async (row) => {
        const entity = byType[row.entityType]?.find((entry) => entry.id === row.entityId);
        if (entity === undefined) return null;
        const readable =
          row.entityType === 'board'
            ? (await this.access.board(user, entity.id)) !== null
            : (await this.access.workspace(user, entity.workspaceId)) !== null;
        if (!readable) return null;
        return {
          entityType: row.entityType as FavoriteType,
          entityId: row.entityId,
          name: entity.name,
          workspaceId: entity.workspaceId,
        };
      }),
    );
    return resolved.filter((entry) => entry !== null);
  }

  async addFavorite(user: AuthPrincipal, entityType: FavoriteType, entityId: string) {
    const readable =
      entityType === 'board'
        ? await this.access.can(user, 'board.read', { type: 'board', id: entityId })
        : entityType === 'workspace'
          ? await this.access.can(user, 'workspace.read', { type: 'workspace', id: entityId })
          : await this.access.can(user, 'workspace.read', {
              type: 'workspace',
              id: (await this.folder(entityId)).workspaceId,
            });
    if (!readable) throw new NotFoundError(entityType === 'board' ? 'Board' : 'Recurso');
    const tx = this.runner.tx;
    const existing = await tx
      .select({ id: favorites.id, position: favorites.position })
      .from(favorites)
      .where(eq(favorites.userId, user.userId));
    const inserted = await tx
      .insert(favorites)
      .values({
        tenantId: user.tenantId,
        userId: user.userId,
        entityType,
        entityId,
        position: positionAmong(existing, {}),
        createdBy: user.userId,
      })
      .onConflictDoNothing()
      .returning({ id: favorites.id });
    if (inserted.length > 0) {
      this.domainEvents.recordChange({
        action: 'favorite.add',
        entityType: 'favorite',
        entityId: inserted[0]?.id ?? null,
        after: { entityType, entityId },
      });
      await this.favoritesChanged(user);
    }
    return { entityType, entityId };
  }

  async removeFavorite(user: AuthPrincipal, entityType: FavoriteType, entityId: string) {
    const removed = await this.runner.tx
      .delete(favorites)
      .where(
        and(
          eq(favorites.userId, user.userId),
          eq(favorites.entityType, entityType),
          eq(favorites.entityId, entityId),
        ),
      )
      .returning({ id: favorites.id });
    if (removed.length === 0) return;
    this.domainEvents.recordChange({
      action: 'favorite.remove',
      entityType: 'favorite',
      entityId: removed[0]?.id ?? null,
      before: { entityType, entityId },
    });
    await this.favoritesChanged(user);
  }

  // ----------------------------------------------------------------------------- Views ---

  async listViews(user: AuthPrincipal, boardId: string) {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const rows = await this.runner.tx
      .select(VIEW_SUMMARY)
      .from(views)
      .where(and(eq(views.boardId, boardId), isNull(views.deletedAt)))
      .orderBy(asc(views.position));
    const allowed = await Promise.all(
      rows.map((row) => this.access.can(user, 'view.read', { type: 'view', id: row.id })),
    );
    const canManage = await this.access.can(user, 'view.manage', { type: 'board', id: boardId });
    const visible = rows.filter((_row, index) => allowed[index] === true);
    const editable = await Promise.all(
      visible.map((row) => this.access.can(user, 'view.update', { type: 'view', id: row.id })),
    );
    return {
      canManage,
      data: visible.map((row, index) => ({
        ...row,
        personal: row.ownerId !== null,
        canEdit: editable[index] ?? false,
      })),
    };
  }

  async createView(user: AuthPrincipal, boardId: string, input: CreateViewInput) {
    const personal = input.personal === true;
    await this.access.assert(
      user,
      personal ? 'board.read' : 'view.manage',
      { type: 'board', id: boardId },
      'Board',
    );
    const tx = this.runner.tx;
    const siblings = await tx
      .select({ id: views.id, position: views.position })
      .from(views)
      .where(and(eq(views.boardId, boardId), isNull(views.deletedAt)));
    const id = newId();
    const position = positionAmong(siblings, {});
    await tx.insert(views).values({
      id,
      tenantId: user.tenantId,
      boardId,
      ownerId: personal ? user.userId : null,
      name: input.name,
      type: input.type,
      position,
      createdBy: user.userId,
    });
    this.domainEvents.recordChange({
      action: 'view.create',
      entityType: 'view',
      entityId: id,
      boardId,
      after: { name: input.name, type: input.type, personal },
    });
    await this.viewChanged(user, boardId, id);
    return {
      id,
      boardId,
      name: input.name,
      type: input.type,
      ownerId: personal ? user.userId : null,
      isDefault: false,
      isLocked: false,
      isRestricted: false,
      position,
      personal,
      canEdit: true,
    };
  }

  async updateView(user: AuthPrincipal, viewId: string, input: UpdateViewInput) {
    const view = await this.view(viewId);
    await this.access.assert(user, 'view.update', { type: 'view', id: viewId }, 'View');
    const set: Partial<typeof views.$inferInsert> = {};
    const before: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== view.name) {
      before.name = view.name;
      set.name = input.name;
    }
    if (input.afterId !== undefined || input.beforeId !== undefined) {
      const siblings = await this.runner.tx
        .select({ id: views.id, position: views.position })
        .from(views)
        .where(and(eq(views.boardId, view.boardId), isNull(views.deletedAt)));
      before.position = view.position;
      set.position = this.place(
        siblings.filter((entry) => entry.id !== viewId),
        input,
      );
    }
    if (Object.keys(set).length === 0) return { id: viewId, changes: {} };
    await this.runner.tx.update(views).set(set).where(eq(views.id, viewId));
    this.domainEvents.recordChange({
      action: 'view.update',
      entityType: 'view',
      entityId: viewId,
      boardId: view.boardId,
      before,
      after: set,
    });
    await this.viewChanged(user, view.boardId, viewId);
    return { id: viewId, changes: set };
  }

  async deleteView(user: AuthPrincipal, viewId: string): Promise<void> {
    const view = await this.view(viewId);
    await this.access.assert(user, 'view.update', { type: 'view', id: viewId }, 'View');
    if (view.isDefault) {
      throw new ValidationError([
        { path: 'params.id', message: 'A view padrão do board não pode ser excluída.' },
      ]);
    }
    await this.runner.tx.update(views).set({ deletedAt: new Date() }).where(eq(views.id, viewId));
    this.domainEvents.recordChange({
      action: 'view.delete',
      entityType: 'view',
      entityId: viewId,
      boardId: view.boardId,
      before: { name: view.name, type: view.type },
    });
    await this.viewChanged(user, view.boardId, viewId);
  }

  // --------------------------------------------------------------------------- Helpers ---

  /** Os vizinhos informados precisam estar no mesmo contêiner de destino. */
  private place(siblings: readonly { id: string; position: string }[], neighbors: Neighbors) {
    for (const [field, id] of [
      ['afterId', neighbors.afterId],
      ['beforeId', neighbors.beforeId],
    ] as const) {
      if (id !== undefined && id !== null && !siblings.some((entry) => entry.id === id)) {
        throw new ValidationError([
          { path: `body.${field}`, message: 'O vizinho informado não está no destino.' },
        ]);
      }
    }
    return positionAmong(siblings, neighbors);
  }

  private async foldersOf(workspaceId: string) {
    return this.runner.tx
      .select({ id: folders.id, parentId: folders.parentId, position: folders.position })
      .from(folders)
      .where(and(eq(folders.workspaceId, workspaceId), isNull(folders.deletedAt)));
  }

  private async boardsIn(workspaceId: string, folderId: string | null) {
    return this.runner.tx
      .select({ id: boards.id, position: boards.position })
      .from(boards)
      .where(
        and(
          eq(boards.workspaceId, workspaceId),
          folderId === null ? isNull(boards.folderId) : eq(boards.folderId, folderId),
          isNull(boards.deletedAt),
        ),
      );
  }

  private async folder(folderId: string) {
    const [folder] = await this.runner.tx
      .select()
      .from(folders)
      .where(and(eq(folders.id, folderId), isNull(folders.deletedAt)));
    if (folder === undefined) throw new NotFoundError('Pasta');
    return folder;
  }

  private async view(viewId: string) {
    const [view] = await this.runner.tx
      .select()
      .from(views)
      .where(and(eq(views.id, viewId), isNull(views.deletedAt)));
    if (view === undefined) throw new NotFoundError('View');
    return view;
  }

  /** Concede ao criador o papel de sistema no recurso criado (dono do board/admin do workspace). */
  private async grant(
    user: AuthPrincipal,
    resourceType: 'workspace' | 'board',
    resourceId: string,
    scope: 'workspace' | 'board',
    roleKey: string,
  ): Promise<void> {
    const tx = this.runner.tx;
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.key, roleKey), eq(roles.scope, scope), isNull(roles.deletedAt)));
    if (role === undefined) throw new Error(`Papel de sistema ausente: ${roleKey}`);
    await tx.insert(accessGrants).values({
      tenantId: user.tenantId,
      resourceType,
      resourceId,
      principalType: 'user',
      principalId: user.userId,
      roleId: role.id,
      createdBy: user.userId,
    });
    await this.access.invalidate(user.tenantId);
  }

  private async structureChanged(user: AuthPrincipal, workspaceId: string): Promise<void> {
    await this.domainEvents.emit({
      tenantId: user.tenantId,
      type: 'workspace.structure_changed',
      aggregateType: 'workspace',
      aggregateId: workspaceId,
      payload: { workspaceId },
      actorId: user.userId,
    });
  }

  private async viewChanged(user: AuthPrincipal, boardId: string, viewId: string): Promise<void> {
    await this.domainEvents.emit({
      tenantId: user.tenantId,
      type: 'view.changed',
      aggregateType: 'view',
      aggregateId: viewId,
      boardId,
      payload: { boardId, viewId },
      actorId: user.userId,
    });
  }

  private async favoritesChanged(user: AuthPrincipal): Promise<void> {
    await this.domainEvents.emit({
      tenantId: user.tenantId,
      type: 'favorites.changed',
      aggregateType: 'user',
      aggregateId: user.userId,
      userId: user.userId,
      payload: {},
      actorId: user.userId,
    });
  }
}
