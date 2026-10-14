import { Inject, Injectable } from '@nestjs/common';
import { meiliQuote, SEARCH_INDEXES, type SearchIndexName } from '@cube-track/shared';
import { MeiliSearch } from 'meilisearch';

import { APP_CONFIG, type AppConfig } from '../../core/config/config.js';
import type { AuthPrincipal } from '../../core/context/request-context.js';
import { AccessService } from '../access/application/access.service.js';

export interface SearchHit {
  id: string;
  type: SearchIndexName;
  title: string;
  boardId: string;
  itemId: string | null;
  snippet: string | null;
}

/**
 * Busca global (Meilisearch) com filtro de permissão aplicado no servidor: tenant + boards legíveis;
 * em boards com escopo "assigned" (convidados), apenas documentos em que o usuário é responsável.
 * Valores de colunas customizadas não são indexados (evita vazamento de colunas restritas).
 */
@Injectable()
export class SearchService {
  private readonly client: MeiliSearch;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly access: AccessService,
  ) {
    this.client = new MeiliSearch({ host: config.MEILI_URL, apiKey: config.MEILI_API_KEY });
  }

  /** Filtro Meilisearch equivalente às permissões do usuário (null = nenhum board legível). */
  async permissionFilter(user: AuthPrincipal, withAssignees: boolean): Promise<string | null> {
    const boards = await this.access.readableBoards(user);
    if (boards.length === 0) return null;
    const principal = await this.access.principal(user);
    const full = boards
      .filter((board) => board.itemScope === 'all')
      .map((board) => meiliQuote(board.boardId));
    const assigned = boards
      .filter((board) => board.itemScope === 'assigned')
      .map((board) => meiliQuote(board.boardId));
    const clauses: string[] = [];
    if (full.length > 0) clauses.push(`boardId IN [${full.join(', ')}]`);
    if (assigned.length > 0) {
      if (withAssignees) {
        const ids = [user.userId, ...principal.teamIds].map(meiliQuote).join(', ');
        clauses.push(`(boardId IN [${assigned.join(', ')}] AND assigneeIds IN [${ids}])`);
      } else {
        clauses.push(`boardId IN [${assigned.join(', ')}]`);
      }
    }
    return `tenantId = ${meiliQuote(user.tenantId)} AND (${clauses.join(' OR ')})`;
  }

  async search(
    user: AuthPrincipal,
    query: string,
    types: SearchIndexName[],
    limit: number,
  ): Promise<SearchHit[]> {
    const itemFilter = await this.permissionFilter(user, true);
    const boardFilter = await this.permissionFilter(user, false);
    if (itemFilter === null || boardFilter === null) return [];
    // Uma consulta por índice: um índice ainda inexistente (tenant novo) não derruba os demais.
    const results = await Promise.all(
      types.map(async (type) => {
        try {
          const response = await this.client.index(type).search(query, {
            limit,
            filter: type === SEARCH_INDEXES.boards ? boardFilter : itemFilter,
            ...(type === SEARCH_INDEXES.updates
              ? { attributesToCrop: ['bodyText'], cropLength: 24 }
              : {}),
          });
          return response.hits.map((hit) =>
            this.toHit(
              type,
              hit as Record<string, unknown> & { _formatted?: Record<string, unknown> },
            ),
          );
        } catch (error) {
          if ((error as { cause?: { code?: string } }).cause?.code === 'index_not_found') return [];
          throw error;
        }
      }),
    );
    return results.flat();
  }

  private toHit(
    type: SearchIndexName,
    document: Record<string, unknown> & { _formatted?: Record<string, unknown> },
  ): SearchHit {
    return {
      id: String(document.id),
      type,
      title: String(type === SEARCH_INDEXES.updates ? document.itemName : document.name),
      boardId: String(document.boardId),
      itemId:
        type === SEARCH_INDEXES.items
          ? String(document.id)
          : type === SEARCH_INDEXES.updates
            ? String(document.itemId)
            : null,
      snippet:
        type === SEARCH_INDEXES.updates
          ? String(document._formatted?.bodyText ?? document.bodyText)
          : null,
    };
  }
}
