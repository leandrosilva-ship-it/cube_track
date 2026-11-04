import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { hasModule } from '@cube-track/shared';
import { and, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { UnprocessableError } from '../../../core/errors/problems.js';
import { ContractsService } from '../../contracts/application/contracts.service.js';
import { ItemsService } from '../../work/application/items.service.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';
import type { AiToolSpec } from './ai-provider.js';

const { memberships, users } = schema;

const MAX_TOOL_ITEMS = 50;

/**
 * Ferramentas (tool use) do assistente lateral (ADR 0055): cada ferramenta é implementada chamando
 * um service de aplicação REAL (`ItemsService`, `ContractsService`), com o `AuthPrincipal` de quem
 * perguntou — é isso que garante, por construção, que "o assistente nunca retorna dado que o usuário
 * não tem permissão de ver" (critério de aceite 1): o módulo de IA nunca monta uma query direta no
 * banco. Nenhum método aqui decide permissão sozinho; quem decide é o service chamado.
 */
@Injectable()
export class AiAssistantToolsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly items: ItemsService,
    private readonly definitions: BoardDefinitionRepository,
    private readonly contracts: ContractsService,
  ) {}

  /** Ferramentas disponíveis para o board (varia conforme os módulos opcionais ativos no workspace). */
  toolsFor(enabledModules: readonly string[]): AiToolSpec[] {
    const tools: AiToolSpec[] = [
      {
        name: 'list_items',
        description:
          'Lista itens do board (com busca textual e filtro por grupo opcionais), já filtrados pela ' +
          'permissão de quem pergunta — colunas e itens sem permissão de leitura nunca aparecem aqui.',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string', description: 'Busca por nome do item (opcional).' },
            groupId: { type: 'string', description: 'Filtra por um grupo específico (opcional).' },
            limit: { type: 'integer', minimum: 1, maximum: MAX_TOOL_ITEMS, default: 20 },
          },
        },
      },
      {
        name: 'get_item',
        description: 'Detalhe completo de um item pelo id, respeitando as mesmas permissões de leitura.',
        inputSchema: {
          type: 'object',
          properties: { itemId: { type: 'string', description: 'Id do item.' } },
          required: ['itemId'],
        },
      },
      {
        name: 'board_summary',
        description: 'Contagem de itens por status e por responsável no board (dados já filtrados por permissão).',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
    if (hasModule(enabledModules, 'contracts')) {
      tools.push({
        name: 'contract_summary',
        description:
          'Lista os contratos do workspace do board com saldo de UST e alertas (vigência, saldo baixo), ' +
          'quando o usuário tem permissão de contratos.',
        inputSchema: { type: 'object', properties: {} },
      });
    }
    return tools;
  }

  /** Executa uma ferramenta; o resultado (string JSON) vira um `tool_result` para o modelo. */
  async execute(
    user: AuthPrincipal,
    context: { boardId: string; workspaceId: string },
    name: string,
    input: unknown,
  ): Promise<string> {
    switch (name) {
      case 'list_items':
        return this.listItems(user, context.boardId, input as { search?: string; groupId?: string; limit?: number });
      case 'get_item':
        return this.getItem(user, input as { itemId?: string });
      case 'board_summary':
        return this.boardSummary(user, context.boardId);
      case 'contract_summary':
        return this.contractSummary(user, context.workspaceId);
      default:
        throw new UnprocessableError(`Ferramenta desconhecida: ${name}`, 'ai_unknown_tool');
    }
  }

  private async directory(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.runner.tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), isNull(memberships.deletedAt)));
    return new Map(rows.filter((row) => ids.includes(row.id)).map((row) => [row.id, row.name]));
  }

  /** Transforma os valores (já redigidos pela permissão) num resumo legível: rótulos e nomes, não ids. */
  private async humanize(boardId: string, values: Readonly<Record<string, unknown>>) {
    const definition = await this.definitions.load(this.runner.tx, boardId);
    if (definition === null) return values;
    const personIds = new Set<string>();
    for (const value of Object.values(values)) {
      const ids = (value as { personIds?: unknown } | null)?.personIds;
      if (Array.isArray(ids)) ids.forEach((id) => personIds.add(String(id)));
    }
    const people = await this.directory([...personIds]);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      const column = definition.columns.find((entry) => entry.key === key);
      if (column === undefined || value === null || typeof value !== 'object') {
        out[key] = value;
        continue;
      }
      const cell = value as Record<string, unknown>;
      if (typeof cell.labelId === 'string') {
        out[column.title] = column.labels.find((label) => label.id === cell.labelId)?.label ?? null;
      } else if (Array.isArray(cell.optionIds)) {
        out[column.title] = cell.optionIds
          .map((id) => column.options.find((option) => option.id === id)?.label ?? String(id))
          .join(', ');
      } else if (Array.isArray(cell.personIds)) {
        out[column.title] = cell.personIds.map((id) => people.get(String(id)) ?? String(id)).join(', ');
      } else if (typeof cell.text === 'string') {
        out[column.title] = cell.text;
      } else if (cell.n !== undefined) {
        out[column.title] = cell.n;
      } else if (typeof cell.d === 'string') {
        out[column.title] = cell.d;
      } else if (typeof cell.checked === 'boolean') {
        out[column.title] = cell.checked;
      } else {
        out[column.title] = cell;
      }
    }
    return out;
  }

  private async listItems(
    user: AuthPrincipal,
    boardId: string,
    input: { search?: string; groupId?: string; limit?: number },
  ): Promise<string> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), MAX_TOOL_ITEMS);
    const page = await this.items.list(user, boardId, {
      filter: null,
      sort: [],
      limit,
      cursor: undefined,
      groupId: input.groupId,
      parentItemId: null,
      includeArchived: false,
      search: input.search,
    });
    const data = await Promise.all(
      page.data.map(async (item) => ({
        id: item.id,
        name: item.name,
        groupId: item.groupId,
        plannedEndDate: item.plannedEndDate,
        values: await this.humanize(boardId, item.values),
      })),
    );
    return JSON.stringify({ items: data, hasMore: page.pageInfo.hasNextPage });
  }

  private async getItem(user: AuthPrincipal, input: { itemId?: string }): Promise<string> {
    if (typeof input.itemId !== 'string') {
      return JSON.stringify({ error: 'itemId é obrigatório.' });
    }
    const item = await this.items.get(user, input.itemId);
    return JSON.stringify({
      id: item.id,
      name: item.name,
      descriptionText: item.descriptionText,
      plannedStartDate: item.plannedStartDate,
      plannedEndDate: item.plannedEndDate,
      actualStartDate: item.actualStartDate,
      actualEndDate: item.actualEndDate,
      progress: item.progress,
      values: await this.humanize(item.boardId, item.values),
    });
  }

  private async boardSummary(user: AuthPrincipal, boardId: string): Promise<string> {
    const page = await this.items.list(user, boardId, {
      filter: null,
      sort: [],
      limit: 1_000,
      cursor: undefined,
      groupId: undefined,
      parentItemId: null,
      includeArchived: false,
    });
    const definition = await this.definitions.load(this.runner.tx, boardId);
    const statusColumn = definition?.columns.find((column) => column.type === 'status');
    const byStatus = new Map<string, number>();
    const byAssignee = new Map<string, number>();
    const peopleColumns = definition?.columns.filter((column) => column.type === 'people') ?? [];
    const personIds = new Set<string>();
    for (const item of page.data) {
      if (statusColumn !== undefined) {
        const cell = item.values[statusColumn.key] as { labelId?: string } | undefined;
        const label = statusColumn.labels.find((entry) => entry.id === cell?.labelId)?.label ?? 'Sem status';
        byStatus.set(label, (byStatus.get(label) ?? 0) + 1);
      }
      for (const column of peopleColumns) {
        const ids = (item.values[column.key] as { personIds?: unknown } | undefined)?.personIds;
        if (Array.isArray(ids)) ids.forEach((id) => personIds.add(String(id)));
      }
    }
    const people = await this.directory([...personIds]);
    for (const item of page.data) {
      for (const column of peopleColumns) {
        const ids = (item.values[column.key] as { personIds?: unknown } | undefined)?.personIds;
        if (!Array.isArray(ids) || ids.length === 0) continue;
        for (const id of ids) {
          const name = people.get(String(id)) ?? String(id);
          byAssignee.set(name, (byAssignee.get(name) ?? 0) + 1);
        }
      }
    }
    return JSON.stringify({
      totalItems: page.data.length,
      truncated: page.pageInfo.hasNextPage,
      byStatus: Object.fromEntries(byStatus),
      byAssignee: Object.fromEntries(byAssignee),
    });
  }

  private async contractSummary(user: AuthPrincipal, workspaceId: string): Promise<string> {
    const contracts = await this.contracts.list(user, workspaceId);
    return JSON.stringify(
      contracts.map((contract) => ({
        number: contract.number,
        title: contract.title,
        clientName: contract.clientName,
        status: contract.status,
        balance: contract.balance,
        alerts: contract.alerts,
      })),
    );
  }
}
