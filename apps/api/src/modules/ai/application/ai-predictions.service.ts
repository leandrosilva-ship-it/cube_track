import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { findDuplicateCandidates, wrapUntrustedContent } from '@cube-track/shared';
import { eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { AccessService } from '../../access/application/access.service.js';
import { ItemsService } from '../../work/application/items.service.js';
import { isItemDone } from '../../work/domain/board-definition.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';
import { completeText } from './ai-completion.util.js';
import { AI_PROVIDER_CLIENT, type AiProviderClient } from './ai-provider.js';
import { AiModuleGuard } from './ai-module-guard.service.js';
import { AiUsageGuard } from './ai-usage-guard.service.js';

const { memberships, users } = schema;

const DUE_SOON_DAYS = 3;
const MAX_ITEMS_SCANNED = 1_000;

export interface DelayRiskEntry {
  itemId: string;
  name: string;
  dueDate: string;
  status: 'overdue' | 'due_soon';
}

export interface AssigneeSuggestionEntry {
  itemId: string;
  name: string;
  suggestedUserId: string;
  suggestedUserName: string;
  reason: string;
}

export interface DuplicateCandidateEntry {
  itemIdA: string;
  nameA: string;
  itemIdB: string;
  nameB: string;
  similarity: number;
}

export interface BoardPredictions {
  narrative: string;
  delayRisk: DelayRiskEntry[];
  assigneeSuggestions: AssigneeSuggestionEntry[];
  duplicates: DuplicateCandidateEntry[];
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Previsões (ADR 0055): risco de atraso e detecção de duplicados são CÁLCULOS DETERMINÍSTICOS (datas
 * planejadas vs. hoje; similaridade de nome — `findDuplicateCandidates`, `packages/shared/src/ai.ts`),
 * não um modelo de IA novo — mais barato e mais auditável. A sugestão de responsável cruza a carga
 * atual (itens abertos por pessoa) já visível no board; sem dados suficientes, não sugere ninguém
 * (nunca inventa). Só a narrativa final em linguagem natural usa o provedor de IA (1 chamada, sem
 * ferramentas) — por isso esta é uma "chamada de IA" para fins de `ai_not_configured`/limite de uso.
 */
@Injectable()
export class AiPredictionsService {
  constructor(
    private readonly runner: TransactionRunner,
    @Inject(AI_PROVIDER_CLIENT) private readonly provider: AiProviderClient,
    private readonly items: ItemsService,
    private readonly definitions: BoardDefinitionRepository,
    private readonly access: AccessService,
    private readonly usageGuard: AiUsageGuard,
    private readonly moduleGuard: AiModuleGuard,
  ) {}

  async forBoard(user: AuthPrincipal, boardId: string): Promise<BoardPredictions> {
    const { workspaceId } = await this.moduleGuard.assertBoardEnabled(boardId);
    await this.access.assert(user, 'ai.use', { type: 'workspace', id: workspaceId });
    const call = await this.usageGuard.requireReady(user.tenantId);

    const definition = await this.definitions.load(this.runner.tx, boardId);
    const page = await this.items.list(user, boardId, {
      filter: null,
      sort: [],
      limit: MAX_ITEMS_SCANNED,
      cursor: undefined,
      groupId: undefined,
      parentItemId: null,
      includeArchived: false,
    });
    const today = new Date().toISOString().slice(0, 10);
    const dueSoonLimit = addDays(today, DUE_SOON_DAYS);

    const delayRisk: DelayRiskEntry[] = [];
    const peopleColumns = definition?.columns.filter((column) => column.type === 'people') ?? [];
    const openCountByUser = new Map<string, number>();
    const unassignedOpenItems: { id: string; name: string }[] = [];

    for (const item of page.data) {
      const done = definition !== null && isItemDone(definition, item.values);
      const dueDate = item.plannedEndDate ?? item.replannedEndDate;
      if (!done && dueDate !== null) {
        if (dueDate < today) delayRisk.push({ itemId: item.id, name: item.name, dueDate, status: 'overdue' });
        else if (dueDate <= dueSoonLimit) delayRisk.push({ itemId: item.id, name: item.name, dueDate, status: 'due_soon' });
      }
      const assignedIds = new Set<string>();
      for (const column of peopleColumns) {
        const ids = (item.values[column.key] as { personIds?: unknown } | undefined)?.personIds;
        if (Array.isArray(ids)) ids.forEach((id) => assignedIds.add(String(id)));
      }
      if (!done) {
        for (const id of assignedIds) openCountByUser.set(id, (openCountByUser.get(id) ?? 0) + 1);
        if (assignedIds.size === 0 && peopleColumns.length > 0) unassignedOpenItems.push({ id: item.id, name: item.name });
      }
    }

    const assigneeSuggestions: AssigneeSuggestionEntry[] = [];
    if (openCountByUser.size > 0 && unassignedOpenItems.length > 0) {
      const leastLoadedId = [...openCountByUser.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
      if (leastLoadedId !== undefined) {
        const [person] = await this.runner.tx
          .select({ name: users.name })
          .from(users)
          .innerJoin(memberships, eq(memberships.userId, users.id))
          .where(eq(users.id, leastLoadedId));
        if (person !== undefined) {
          const load = openCountByUser.get(leastLoadedId) ?? 0;
          for (const item of unassignedOpenItems.slice(0, 20)) {
            assigneeSuggestions.push({
              itemId: item.id,
              name: item.name,
              suggestedUserId: leastLoadedId,
              suggestedUserName: person.name,
              reason: `Menor carga atual no board (${String(load)} item(ns) aberto(s) sob responsabilidade).`,
            });
          }
        }
      }
    }

    const duplicates: DuplicateCandidateEntry[] = findDuplicateCandidates(
      page.data.map((item) => ({ id: item.id, name: item.name })),
      0.6,
    )
      .slice(0, 20)
      .map(({ a, b, similarity }) => ({ itemIdA: a.id, nameA: a.name, itemIdB: b.id, nameB: b.name, similarity }));

    const content = wrapUntrustedContent(
      'predictions_data',
      JSON.stringify({
        overdue: delayRisk.filter((entry) => entry.status === 'overdue').length,
        dueSoon: delayRisk.filter((entry) => entry.status === 'due_soon').length,
        assigneeSuggestions: assigneeSuggestions.length,
        duplicates: duplicates.length,
      }),
    );
    let narrative = '';
    try {
      const result = await completeText(
        this.provider,
        call.apiKey,
        call.model,
        'Narre em português, em até 3 frases, o resumo de previsões do board a seguir (dados JÁ ' +
          'calculados — não invente números novos, apenas explique o que significam).',
        content,
      );
      narrative = result.text;
      await this.usageGuard.record({
        tenantId: user.tenantId,
        userId: user.userId,
        feature: 'prediction',
        model: call.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
    } catch (error) {
      await this.usageGuard.record({
        tenantId: user.tenantId,
        userId: user.userId,
        feature: 'prediction',
        model: call.model,
        inputTokens: 0,
        outputTokens: 0,
      });
      throw error;
    }

    return { narrative, delayRisk, assigneeSuggestions, duplicates };
  }
}
