import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { FilterGroupSchema, parseSort } from '@cube-track/shared';

import { CurrentPrincipal } from '../../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../../core/context/request-context.js';
import { ValidationError } from '../../../../core/errors/problems.js';
import { BoardsService } from '../../application/boards.service.js';
import { ItemsService } from '../../application/items.service.js';
import { JSONScalar } from './json.scalar.js';
import {
  BoardSummaryType,
  BoardType,
  ItemConnectionType,
  ItemType,
  WorkspaceType,
} from './types.js';

/**
 * GraphQL somente leitura (ADR 0009): mesmos casos de uso e mesmas regras de permissão/redação do REST.
 * Cada campo raiz roda numa transação read-only com contexto do tenant (TransactionInterceptor).
 */
@Resolver()
export class WorkResolver {
  constructor(
    private readonly boardsService: BoardsService,
    private readonly itemsService: ItemsService,
  ) {}

  @Query(() => [WorkspaceType])
  workspaces(@CurrentPrincipal() user: AuthPrincipal) {
    return this.boardsService.listWorkspaces(user);
  }

  @Query(() => [BoardSummaryType])
  boards(
    @CurrentPrincipal() user: AuthPrincipal,
    @Args('workspaceId', { type: () => ID }) workspaceId: string,
  ) {
    return this.boardsService.listBoards(user, workspaceId);
  }

  @Query(() => BoardType)
  board(@CurrentPrincipal() user: AuthPrincipal, @Args('id', { type: () => ID }) id: string) {
    return this.boardsService.getBoard(user, id);
  }

  @Query(() => ItemType)
  item(@CurrentPrincipal() user: AuthPrincipal, @Args('id', { type: () => ID }) id: string) {
    return this.itemsService.get(user, id);
  }

  @Query(() => ItemConnectionType)
  items(
    @CurrentPrincipal() user: AuthPrincipal,
    @Args('boardId', { type: () => ID }) boardId: string,
    @Args('first', { type: () => Int, defaultValue: 50 }) first: number,
    @Args('after', { type: () => String, nullable: true }) after: string | null,
    @Args('filter', { type: () => JSONScalar, nullable: true }) filter: unknown,
    @Args('sort', { type: () => String, nullable: true }) sort: string | null,
    @Args('groupId', { type: () => ID, nullable: true }) groupId: string | null,
  ) {
    if (first < 1 || first > 500)
      throw new ValidationError([{ path: 'first', message: 'Use entre 1 e 500.' }]);
    const parsedFilter =
      filter === null || filter === undefined ? null : FilterGroupSchema.parse(filter);
    let parsedSort;
    try {
      parsedSort = parseSort(sort ?? undefined);
    } catch (error) {
      throw new ValidationError([
        { path: 'sort', message: error instanceof Error ? error.message : 'Ordenação inválida.' },
      ]);
    }
    return this.itemsService.list(user, boardId, {
      filter: parsedFilter,
      sort: parsedSort,
      limit: first,
      cursor: after ?? undefined,
      groupId: groupId ?? undefined,
      parentItemId: null,
      includeArchived: false,
    });
  }
}
