import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { isReadOnlyColumnType, parseCellText, PROMPT_INJECTION_GUARD, wrapUntrustedContent } from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { AppError, UnprocessableError, ValidationError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsService } from '../../work/application/items.service.js';
import type { ItemDto } from '../../work/domain/item.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';
import { AI_PROVIDER_CLIENT, type AiProviderClient } from './ai-provider.js';
import { AiModuleGuard } from './ai-module-guard.service.js';
import { AiUsageGuard } from './ai-usage-guard.service.js';

const { groups, memberships, teams, users } = schema;

const MAX_TOKENS = 1_000;
const TOOL_NAME = 'extract_item';

const SYSTEM_PROMPT =
  'Você extrai um item de board de gestão de projetos a partir de um texto livre (e-mail, bilhete, ' +
  'descrição de demanda). Preencha o nome do item e, quando o texto tiver informação equivalente, o ' +
  'texto bruto para cada coluna listada (você NUNCA inverta tipos: para uma coluna de pessoas, escreva ' +
  'o nome da pessoa; para uma data, escreva a data como aparece no texto). Nunca invente informação que ' +
  'não está no texto — deixe a coluna de fora quando não houver equivalente. ' +
  PROMPT_INJECTION_GUARD;

export interface CreateItemFromTextResult {
  item: ItemDto;
  /** Colunas que o modelo tentou preencher mas cujo texto não pôde ser convertido (ignoradas). */
  skippedColumns: string[];
}

/**
 * Criação de item a partir de texto livre (ADR 0055): o modelo só decide QUAL texto vai em QUAL
 * coluna (saída estruturada, 1 chamada forçada à ferramenta `extract_item`); a conversão/validação
 * final de cada valor usa `parseCellText` (packages/shared/src/columns/text.ts), a mesma função
 * determinística já testada usada por colar células e importar planilhas — nunca reimplementada
 * aqui. `ItemsService.create` é quem de fato cria o item e checa a permissão `item.create`.
 */
@Injectable()
export class AiItemCreationService {
  constructor(
    private readonly runner: TransactionRunner,
    @Inject(AI_PROVIDER_CLIENT) private readonly provider: AiProviderClient,
    private readonly items: ItemsService,
    private readonly definitions: BoardDefinitionRepository,
    private readonly access: AccessService,
    private readonly usageGuard: AiUsageGuard,
    private readonly moduleGuard: AiModuleGuard,
  ) {}

  async createFromText(
    user: AuthPrincipal,
    boardId: string,
    text: string,
    groupId: string | undefined,
  ): Promise<CreateItemFromTextResult> {
    const { workspaceId } = await this.moduleGuard.assertBoardEnabled(boardId);
    await this.access.assert(user, 'ai.use', { type: 'workspace', id: workspaceId });
    const call = await this.usageGuard.requireReady(user.tenantId);
    const definition = await this.definitions.load(this.runner.tx, boardId);
    if (definition === null) throw new UnprocessableError('Board sem definição.', 'board_without_definition');
    const writableColumns = definition.columns.filter((column) => !isReadOnlyColumnType(column.type));
    const properties: Record<string, unknown> = {
      name: { type: 'string', description: 'Nome/título curto do item.' },
    };
    const columnsSchema: Record<string, unknown> = {};
    for (const column of writableColumns) {
      const hint =
        column.type === 'status'
          ? ` (opções: ${column.labels.map((label) => label.label).join(', ')})`
          : column.type === 'dropdown'
            ? ` (opções: ${column.options.map((option) => option.label).join(', ')})`
            : '';
      columnsSchema[column.key] = {
        type: 'string',
        description: `${column.title} (tipo ${column.type})${hint} — texto bruto equivalente no documento, se houver.`,
      };
    }
    properties.columns = { type: 'object', properties: columnsSchema };

    let failure: unknown;
    let name = '';
    let extractedColumns: Record<string, string> = {};
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const result = await this.provider.complete({
        apiKey: call.apiKey,
        model: call.model,
        system: SYSTEM_PROMPT,
        maxTokens: MAX_TOKENS,
        forceTool: TOOL_NAME,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Registra o item extraído do texto.',
            inputSchema: { type: 'object', properties, required: ['name'] },
          },
        ],
        messages: [{ role: 'user', content: wrapUntrustedContent('document', text) }],
      });
      inputTokens = result.usage.inputTokens;
      outputTokens = result.usage.outputTokens;
      const call_ = result.toolCalls[0];
      if (call_ === undefined) throw new UnprocessableError('O modelo não extraiu um item.', 'ai_extraction_failed');
      const parsed = call_.input as { name?: unknown; columns?: Record<string, unknown> };
      if (typeof parsed.name !== 'string' || parsed.name.trim() === '') {
        throw new UnprocessableError('O modelo não identificou um nome para o item.', 'ai_extraction_failed');
      }
      name = parsed.name.trim().slice(0, 300);
      extractedColumns = Object.fromEntries(
        Object.entries(parsed.columns ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
        ),
      );
    } catch (error) {
      failure = error;
    }
    await this.usageGuard.record({
      tenantId: user.tenantId,
      userId: user.userId,
      feature: 'item_create',
      model: call.model,
      inputTokens,
      outputTokens,
    });
    if (failure !== undefined) {
      throw failure instanceof AppError
        ? failure
        : new UnprocessableError('Falha ao consultar o provedor de IA.', 'ai_provider_error');
    }

    const directory = await this.textDirectory();
    const values: Record<string, unknown> = {};
    const skippedColumns: string[] = [];
    for (const [key, rawText] of Object.entries(extractedColumns)) {
      const column = writableColumns.find((entry) => entry.key === key);
      if (column === undefined) continue;
      const parsed = parseCellText(
        {
          key: column.key,
          type: column.type,
          settings: column.settings,
          labels: column.labels,
          options: column.options,
        },
        rawText,
        directory,
      );
      if (parsed.ok && parsed.value !== null) values[key] = parsed.value;
      else skippedColumns.push(key);
    }

    const resolvedGroupId = groupId ?? (await this.defaultGroup(boardId));
    if (resolvedGroupId === null) {
      throw new ValidationError([{ path: 'body.groupId', message: 'O board não tem grupos ativos.' }]);
    }
    const item = await this.items.create(user, boardId, { groupId: resolvedGroupId, name, values });
    return { item, skippedColumns };
  }

  private async defaultGroup(boardId: string): Promise<string | null> {
    const [group] = await this.runner.tx
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt), isNull(groups.archivedAt)))
      .orderBy(asc(groups.position))
      .limit(1);
    return group?.id ?? null;
  }

  private async textDirectory() {
    const people = await this.runner.tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(isNull(memberships.deletedAt));
    const teamRows = await this.runner.tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(isNull(teams.deletedAt));
    return { people, teams: teamRows };
  }
}
