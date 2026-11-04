import { randomBytes } from 'node:crypto';

import { schema, type DatabaseHandle } from '@cube-track/db';
import { encryptSecret } from '@cube-track/shared/crypto';
import { MAX_AUTOMATION_DEPTH, newId, positionBetween } from '@cube-track/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AgentDecisionResult } from '../src/ai-provider.js';
import { aiAgentsProcessor } from '../src/processors/ai-agents.js';
import { adminDb, appDb, demoContext, domainEvent, fakeJob, redisClient, silentLogger, type DemoContext } from './helpers.js';

const { aiAgents, aiAgentRuns, aiSettings, columnDefinitions, items } = schema;

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

let admin: DatabaseHandle;
let app: DatabaseHandle;
let redis: Redis;
let demo: DemoContext;
let textColumnKey: string;
let agentId: string;

beforeAll(async () => {
  admin = adminDb();
  app = appDb();
  redis = redisClient();
  demo = await demoContext(admin);

  const [textColumn] = await admin.db
    .select({ key: columnDefinitions.key })
    .from(columnDefinitions)
    .where(and(eq(columnDefinitions.boardId, demo.boardId), eq(columnDefinitions.type, 'text')))
    .limit(1);
  if (textColumn === undefined) throw new Error('Board PMSP sem coluna de texto para o teste.');
  textColumnKey = textColumn.key;

  await admin.db
    .insert(aiSettings)
    .values({
      tenantId: demo.tenantId,
      provider: 'anthropic',
      apiKeyCiphertext: encryptSecret('sk-test-fake-key', ENCRYPTION_KEY),
      model: 'claude-haiku-5-5',
      enabled: true,
      monthlyTokenLimit: null,
      monthlyCostLimitCents: null,
    })
    .onConflictDoUpdate({
      target: aiSettings.tenantId,
      set: { enabled: true, apiKeyCiphertext: encryptSecret('sk-test-fake-key', ENCRYPTION_KEY) },
    });

  const [agent] = await admin.db
    .insert(aiAgents)
    .values({
      tenantId: demo.tenantId,
      workspaceId: demo.workspaceId,
      boardId: demo.boardId,
      name: 'Agente de teste',
      instructions: 'Sempre proponha preencher a coluna de texto com um valor de teste.',
      trigger: { type: 'item_created', config: {} },
      allowedActions: ['set_column_value'],
      isActive: true,
    })
    .returning({ id: aiAgents.id });
  if (agent === undefined) throw new Error('Falha ao criar agente de teste.');
  agentId = agent.id;
});

afterAll(async () => {
  await admin.db.delete(aiAgentRuns).where(eq(aiAgentRuns.agentId, agentId));
  await admin.db.delete(aiAgents).where(eq(aiAgents.id, agentId));
  redis.disconnect();
  await Promise.all([admin.close(), app.close()]);
});

async function createItem(name: string) {
  const groupId = Object.values(demo.groups)[0] ?? '';
  const [last] = await admin.db
    .select({ position: items.position })
    .from(items)
    .where(eq(items.groupId, groupId))
    .orderBy(desc(items.position))
    .limit(1);
  const [item] = await admin.db
    .insert(items)
    .values({
      tenantId: demo.tenantId,
      boardId: demo.boardId,
      groupId,
      name,
      position: positionBetween(last?.position ?? null, null),
    })
    .returning();
  if (item === undefined) throw new Error('Falha ao criar item de teste.');
  return item;
}

describe('agentes de IA (ADR 0055) — avaliação de gatilho e proposta no worker', () => {
  it('evento dispara a avaliação do gatilho → chama a IA (mockada) → cria `ai_agent_runs` pending_approval', async () => {
    const item = await createItem('Item de teste — agente de IA');
    const decide = vi.fn<() => Promise<AgentDecisionResult>>(() => Promise.resolve({
      reasoning: 'A coluna de texto estava vazia; preenchendo com um valor de exemplo.',
      action: { type: 'set_column_value', columnKey: textColumnKey, textValue: 'Valor proposto pela IA' },
      usage: { inputTokens: 42, outputTokens: 7 },
    }));
    const processor = aiAgentsProcessor({ database: app, redis, logger: silentLogger, encryptionKey: ENCRYPTION_KEY, decide });

    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.created',
      boardId: demo.boardId,
      itemId: item.id,
      depth: 0,
    });
    const { outcomes } = await processor.processEvent(fakeJob(event));
    expect(outcomes).toEqual([{ agentId, status: 'proposed' }]);
    expect(decide).toHaveBeenCalledTimes(1);

    const [run] = await admin.db
      .select()
      .from(aiAgentRuns)
      .where(and(eq(aiAgentRuns.agentId, agentId), eq(aiAgentRuns.itemId, item.id)));
    expect(run).toBeDefined();
    expect(run?.status).toBe('pending_approval');
    expect(run?.reasoning).toContain('valor de exemplo');
    expect(run?.proposedAction).toEqual({
      type: 'set_column_value',
      config: { columnKey: textColumnKey, value: { text: 'Valor proposto pela IA' } },
    });
    expect(run?.inputTokens).toBe(42);
    expect(run?.outputTokens).toBe(7);

    // Reentrega do mesmo evento (BullMQ) não chama a IA de novo nem duplica a proposta (dedupe).
    const second = await processor.processEvent(fakeJob(event));
    expect(second.outcomes).toEqual([{ agentId, status: 'duplicate' }]);
    expect(decide).toHaveBeenCalledTimes(1);

    const runsForItem = await admin.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.itemId, item.id));
    expect(runsForItem).toHaveLength(1);
  });

  it('respeita a profundidade máxima da cadeia (não avalia além de MAX_AUTOMATION_DEPTH)', async () => {
    const item = await createItem('Item de teste — profundidade máxima');
    const decide = vi.fn<() => Promise<AgentDecisionResult>>(() => Promise.resolve({
      reasoning: 'não deveria rodar',
      action: { type: 'no_action' },
      usage: { inputTokens: 0, outputTokens: 0 },
    }));
    const processor = aiAgentsProcessor({ database: app, redis, logger: silentLogger, encryptionKey: ENCRYPTION_KEY, decide });
    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.created',
      boardId: demo.boardId,
      itemId: item.id,
      depth: MAX_AUTOMATION_DEPTH,
    });
    const { outcomes, skipped } = await processor.processEvent(fakeJob(event));
    expect(skipped).toBe('depth');
    expect(outcomes).toEqual([]);
    expect(decide).not.toHaveBeenCalled();
  });

  it('quando o modelo decide "no_action", nenhuma linha de `ai_agent_runs` fica pendente', async () => {
    const item = await createItem('Item de teste — no_action');
    const decide = vi.fn<() => Promise<AgentDecisionResult>>(() => Promise.resolve({
      reasoning: 'nada a propor',
      action: { type: 'no_action' },
      usage: { inputTokens: 5, outputTokens: 1 },
    }));
    const processor = aiAgentsProcessor({ database: app, redis, logger: silentLogger, encryptionKey: ENCRYPTION_KEY, decide });
    const event = domainEvent({
      eventId: newId(),
      tenantId: demo.tenantId,
      type: 'item.created',
      boardId: demo.boardId,
      itemId: item.id,
      depth: 0,
    });
    const { outcomes } = await processor.processEvent(fakeJob(event));
    expect(outcomes).toEqual([{ agentId, status: 'no_action' }]);
    const runs = await admin.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.itemId, item.id));
    expect(runs).toHaveLength(0);
  });
});
