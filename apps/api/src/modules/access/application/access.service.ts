import { Inject, Injectable } from '@nestjs/common';
import {
  decide,
  type Action,
  type BoardAccess,
  type ColumnRef,
  type ItemRef,
  type PrincipalAccess,
  type WorkspaceAccess,
} from '@cube-track/shared';
import type { Transaction } from '@cube-track/db';
import type { Redis } from 'ioredis';

import { hasScope } from '@cube-track/shared/api-access';

import { currentContext, type AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../../core/errors/problems.js';
import { appMetrics } from '../../../core/observability/metrics.js';
import { REDIS } from '../../../core/redis/redis.module.js';
import { scopeForAction } from './api-scope-map.js';
import {
  buildRoleCatalog,
  computeBoardAccess,
  computeWorkspaceAccess,
  explicitPermissions,
  type RoleCatalog,
  type RoleDefinition,
} from '../domain/effective-access.js';
import { AccessRepository, type BoardColumn } from '../infrastructure/access.repository.js';

export type ResourceLocator =
  | { type: 'tenant' }
  | { type: 'workspace'; id: string }
  | { type: 'board'; id: string }
  | {
      type: 'item';
      item: { id: string; boardId: string; values: Readonly<Record<string, unknown>> };
    }
  | {
      type: 'column';
      boardId: string;
      key: string;
      item?: { id: string; values: Readonly<Record<string, unknown>> };
    }
  | { type: 'view'; id: string }
  | { type: 'dashboard'; id: string };

const CACHE_TTL_SECONDS = 300;

/**
 * Serviço central de autorização: `can(user, action, resource)`.
 * Carrega o retrato das permissões efetivas (papéis, concessões, times, herança) e decide com a
 * função pura `decide` (packages/shared). Retratos ficam em cache no Redis por tenant, invalidados
 * por versão (`acl:{tenant}:v`) a cada mudança de papel/concessão/membership/coluna.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly repository: AccessRepository,
    private readonly runner: TransactionRunner,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ----------------------------------------------------------------------------------- API ---

  async can(user: AuthPrincipal, action: Action, resource: ResourceLocator): Promise<boolean> {
    if (user.authKind === 'api_token') {
      // Teto de escopo do token (ADR 0056): verificado ANTES do RBAC normal, nunca no lugar dele — um
      // token só pode o que (a) seu escopo cobre E (b) o dono/app poderia fazer de qualquer forma.
      const scope = scopeForAction(action);
      if (scope === null || !hasScope(user.scopes ?? [], scope)) return false;
    }
    const principal = await this.principal(user);
    switch (resource.type) {
      case 'tenant':
        return decide(principal, action, { type: 'tenant' });
      case 'workspace':
        return decide(principal, action, {
          type: 'workspace',
          workspace: await this.workspace(user, resource.id),
        });
      case 'board':
        return decide(principal, action, {
          type: 'board',
          board: await this.board(user, resource.id),
        });
      case 'item': {
        const board = await this.board(user, resource.item.boardId);
        return decide(principal, action, {
          type: 'item',
          board,
          item: await this.itemRef(user, resource.item, board),
        });
      }
      case 'column': {
        const board = await this.board(user, resource.boardId);
        const column = (await this.columns(user.tenantId, resource.boardId)).find(
          (entry) => entry.key === resource.key,
        );
        if (column === undefined) return false;
        const item =
          resource.item === undefined
            ? undefined
            : await this.itemRef(user, { ...resource.item, boardId: resource.boardId }, board);
        return decide(principal, action, {
          type: 'column',
          board,
          column,
          ...(item === undefined ? {} : { item }),
        });
      }
      case 'view': {
        const view = await this.read(user, (tx) => this.repository.loadView(tx, resource.id));
        if (view === null) return false;
        const grants = await this.read(user, (tx) =>
          this.repository.loadGrants(tx, 'view', view.id),
        );
        const catalog = await this.catalog(user);
        return decide(principal, action, {
          type: 'view',
          board: await this.board(user, view.boardId),
          view: {
            ...view,
            explicitGrant: explicitPermissions(principal, catalog, grants).length > 0,
          },
        });
      }
      case 'dashboard': {
        const dashboard = await this.read(user, (tx) =>
          this.repository.loadDashboard(tx, resource.id),
        );
        if (dashboard === null) return false;
        return decide(principal, action, {
          type: 'dashboard',
          workspace: await this.workspace(user, dashboard.workspaceId),
          dashboard,
        });
      }
    }
  }

  /**
   * Garante a permissão. Quando o usuário nem pode ver o recurso, responde 404 (não revela a
   * existência); quando vê mas não pode agir, 403.
   */
  async assert(
    user: AuthPrincipal,
    action: Action,
    resource: ResourceLocator,
    notFoundEntity?: string,
  ): Promise<void> {
    if (await this.can(user, action, resource)) return;
    if (notFoundEntity !== undefined) {
      const readAction = readActionFor(resource);
      if (readAction !== null && !(await this.can(user, readAction, resource)))
        throw new NotFoundError(notFoundEntity);
    }
    throw new ForbiddenError(undefined, 'forbidden', { action });
  }

  async principal(user: AuthPrincipal): Promise<PrincipalAccess> {
    return this.cached(user.tenantId, `p:${user.userId}`, async () => {
      const row = await this.read(user, (tx) => this.repository.loadPrincipal(tx, user.userId));
      if (row === null) return null;
      return {
        userId: user.userId,
        tenantId: user.tenantId,
        kind: row.kind,
        tenantRoleId: row.roleId,
        tenantRoleKey: row.roleKey,
        tenantPermissions: row.permissions,
        teamIds: row.teamIds,
        orgUnit: row.orgUnit,
      } satisfies PrincipalAccess;
    }).then((value) => {
      if (value === null)
        throw new UnauthorizedError(
          'membership_inactive',
          'Você não participa mais desta organização.',
        );
      return value;
    });
  }

  async workspace(user: AuthPrincipal, workspaceId: string): Promise<WorkspaceAccess | null> {
    return this.cached(user.tenantId, `w:${user.userId}:${workspaceId}`, async () => {
      const principal = await this.principal(user);
      const catalog = await this.catalog(user);
      const workspace = await this.read(user, (tx) =>
        this.repository.loadWorkspace(tx, workspaceId),
      );
      if (workspace === null) return null;
      const grants = await this.read(user, (tx) =>
        this.repository.loadGrants(tx, 'workspace', workspaceId),
      );
      return computeWorkspaceAccess(principal, catalog, workspace, grants);
    });
  }

  async board(user: AuthPrincipal, boardId: string): Promise<BoardAccess | null> {
    return this.cached(user.tenantId, `b:${user.userId}:${boardId}`, async () => {
      const principal = await this.principal(user);
      const board = await this.read(user, (tx) => this.repository.loadBoard(tx, boardId));
      if (board === null) return null;
      const catalog = await this.catalog(user);
      const workspace = await this.workspace(user, board.workspaceId);
      const grants = await this.read(user, (tx) =>
        this.repository.loadGrants(tx, 'board', boardId),
      );
      const columns = await this.columns(user.tenantId, boardId);
      const peopleKeys = columns
        .filter((column) => column.type === 'people')
        .map((column) => column.key);
      const guestOrgColumn =
        board.guestOrgColumnId === null
          ? null
          : (columns.find((column) => column.id === board.guestOrgColumnId) ?? null);
      return computeBoardAccess(
        principal,
        catalog,
        workspace,
        board,
        grants,
        peopleKeys,
        guestOrgColumn === null ? null : { key: guestOrgColumn.key, type: guestOrgColumn.type },
      );
    });
  }

  /** Colunas do board (com restrições de permissão). Cache por board e versão. */
  async columns(tenantId: string, boardId: string): Promise<BoardColumn[]> {
    const user = currentContext()?.principal;
    const scope = user?.tenantId === tenantId ? user : { tenantId, userId: null };
    return this.cached(tenantId, `cols:${boardId}`, () =>
      this.runner.run(
        { tenantId, userId: scope.userId },
        () => this.repository.loadColumns(this.runner.tx, boardId),
        {
          readOnly: true,
        },
      ),
    );
  }

  /** Colunas que o usuário não pode ler (para redação) — `null` se não tem acesso ao board. */
  async hiddenColumns(
    user: AuthPrincipal,
    boardId: string,
  ): Promise<{ hidden: Set<string>; columns: BoardColumn[] }> {
    const principal = await this.principal(user);
    const board = await this.board(user, boardId);
    const columns = await this.columns(user.tenantId, boardId);
    const hidden = new Set(
      columns
        .filter(
          (column) =>
            !decide(principal, 'column.read', {
              type: 'column',
              board,
              column: column satisfies ColumnRef,
            }),
        )
        .map((column) => column.key),
    );
    return { hidden, columns };
  }

  /** Boards legíveis do tenant (busca global). */
  async readableBoards(user: AuthPrincipal): Promise<BoardAccess[]> {
    const ids = await this.read(user, (tx) => this.repository.listBoardIds(tx));
    const accesses = await Promise.all(ids.map((id) => this.board(user, id)));
    return accesses.filter((access): access is BoardAccess => access !== null);
  }

  /** Invalida todo o cache de permissões do tenant (incrementa a versão). */
  async invalidate(tenantId: string): Promise<void> {
    const bump = async () => {
      await this.redis.incr(`acl:${tenantId}:v`);
    };
    const store = currentContext();
    // Dentro de uma transação, invalida só após o commit (evita recachear dados antigos).
    if (store?.tx !== null && store?.tx !== undefined) store.afterCommit.push(bump);
    else await bump();
  }

  // ------------------------------------------------------------------------------ internos ---

  private async itemRef(
    user: AuthPrincipal,
    item: { id: string; boardId: string; values: Readonly<Record<string, unknown>> },
    board: BoardAccess | null = null,
  ): Promise<ItemRef> {
    const grantPermissions = await this.cached(
      user.tenantId,
      `ig:${user.userId}:${item.id}`,
      async () => {
        const principal = await this.principal(user);
        const catalog = await this.catalog(user);
        const grants = await this.read(user, (tx) =>
          this.repository.loadGrants(tx, 'item', item.id),
        );
        return explicitPermissions(principal, catalog, grants);
      },
    );
    // Visibilidade por órgão (ADR 0057): resolvida aqui (acesso ao banco), nunca dentro de `decide`
    // (função pura) — reusa o MESMO comparador da listagem em massa (`org-match.ts`).
    let matchesGuestOrg: boolean | undefined;
    const guestOrgUnit = board?.guestOrgUnit;
    if (board?.itemScope === 'org' && board.guestOrgColumnKey !== null && guestOrgUnit !== null && guestOrgUnit !== undefined) {
      const columns = await this.columns(user.tenantId, item.boardId);
      const column = columns.find((entry) => entry.key === board.guestOrgColumnKey);
      matchesGuestOrg =
        column !== undefined &&
        (await this.read(user, (tx) =>
          this.repository.itemMatchesOrgUnit(tx, item.id, column, guestOrgUnit),
        ));
    }
    return {
      id: item.id,
      values: item.values,
      grantPermissions,
      ...(matchesGuestOrg === undefined ? {} : { matchesGuestOrg }),
    };
  }

  private async catalog(user: AuthPrincipal): Promise<RoleCatalog> {
    const roles = await this.cached<RoleDefinition[]>(user.tenantId, 'roles', () =>
      this.read(user, (tx) => this.repository.loadRoles(tx)),
    );
    return buildRoleCatalog(roles);
  }

  private read<T>(
    user: Pick<AuthPrincipal, 'tenantId' | 'userId'>,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const store = currentContext();
    if (store?.tx !== null && store?.tx !== undefined) return work(store.tx);
    return this.runner.run(
      { tenantId: user.tenantId, userId: user.userId },
      () => work(this.runner.tx),
      { readOnly: true },
    );
  }

  private async cached<T>(tenantId: string, key: string, load: () => Promise<T>): Promise<T> {
    const version = (await this.redis.get(`acl:${tenantId}:v`)) ?? '0';
    const cacheKey = `acl:${tenantId}:${version}:${key}`;
    const hit = await this.redis.get(cacheKey);
    if (hit !== null) {
      appMetrics.permissionCacheHits.add(1);
      return JSON.parse(hit) as T;
    }
    appMetrics.permissionCacheMisses.add(1);
    const value = await load();
    await this.redis.set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    return value;
  }
}

function readActionFor(resource: ResourceLocator): Action | null {
  switch (resource.type) {
    case 'board':
      return 'board.read';
    case 'item':
      return 'item.read';
    case 'workspace':
      return 'workspace.read';
    case 'view':
      return 'view.read';
    case 'dashboard':
      return 'dashboard.read';
    case 'column':
      return 'column.read';
    case 'tenant':
      return null;
  }
}
