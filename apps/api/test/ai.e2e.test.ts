import { DEMO_TENANT_ID, schema } from '@cube-track/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AI_PROVIDER_CLIENT, type AiCompleteResult, type AiProviderClient } from '../src/modules/ai/application/ai-provider.js';
import {
  adminDb,
  client,
  demoIds,
  requiredValues,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
  type BoardDetailFixture,
} from './helpers.js';

const { aiAgentRuns, aiUsageLogs } = schema;

interface AiSettingsResponse {
  provider: string;
  model: string;
  enabled: boolean;
  hasApiKey: boolean;
  monthlyTokenLimit: number | null;
  monthlyCostLimitCents: number | null;
}
interface AssistantResponse {
  answer: string;
  toolCalls: string[];
  usage: { inputTokens: number; outputTokens: number };
}
interface ProblemBody {
  code: string;
  detail: string;
}
interface Item {
  id: string;
  values: Record<string, { optionIds?: string[] } | undefined>;
}
interface AiAgent {
  id: string;
  isActive: boolean;
}
interface AiAgentRun {
  id: string;
  status: string;
}
interface WorkspaceDto {
  enabledModules: string[];
}
interface Member {
  userId: string;
  email: string;
}

function textResult(text: string): AiCompleteResult {
  return { textOutput: text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn' };
}
function toolCallResult(name: string, input: unknown): AiCompleteResult {
  return {
    textOutput: null,
    toolCalls: [{ id: 'tool_1', name, input }],
    usage: { inputTokens: 20, outputTokens: 10 },
    stopReason: 'tool_use',
  };
}
function extractToolCallResult(input: Record<string, unknown>): AiCompleteResult {
  return {
    textOutput: null,
    toolCalls: [{ id: 'tool_1', name: 'extract_item', input }],
    usage: { inputTokens: 15, outputTokens: 8 },
    stopReason: 'tool_use',
  };
}

/** Extrai o bloco `tool_result` da 2ª chamada ao provedor (a que recebe o resultado da ferramenta). */
function secondCallToolResult(spy: ReturnType<typeof vi.fn<AiProviderClient['complete']>>) {
  const call = spy.mock.calls[1];
  if (call === undefined) throw new Error('o provedor deveria ter sido chamado uma segunda vez.');
  const [input] = call;
  const userTurn = input.messages.at(-1);
  const content = typeof userTurn?.content === 'string' ? [] : (userTurn?.content ?? []);
  const block = content.find((entry) => entry.type === 'tool_result');
  if (block === undefined) throw new Error('bloco tool_result ausente.');
  return block;
}

describe('Módulo de IA (ADR 0055) — configuração, assistente, criação por texto e agentes', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ana: string; // owner: ai.manage + ai.use/ai.agents.*
  let thiago: string; // viewer: board.read, sem `ai.use`/`ai.manage`/`ai.agents.*` no workspace
  let rafael: string; // workspace_member: tem `ai.use`, mas sem permissão na coluna restrita
  let anaUserId: string;
  let workspaceId: string;
  let boardId: string;
  let board: BoardDetailFixture;
  /** Coluna dropdown `c_orgao` (não vinculada, com opções fixas) — usada em todo o arquivo. */
  let orgColumn: BoardDetailFixture['columns'][number];
  let originalModules: string[];
  let completeSpy: ReturnType<typeof vi.fn<AiProviderClient['complete']>>;

  const db = adminDb();

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    ana = await api.login(USERS.ana);
    thiago = await api.login(USERS.thiago);
    rafael = await api.login(USERS.rafael);
    const demo = await demoIds(api, ana);
    workspaceId = demo.workspaceId;
    boardId = demo.boardId;
    board = demo.board;
    const found = board.columns.find((column) => column.key === 'c_orgao');
    if (found === undefined || found.options.length < 2) {
      throw new Error('Board PMSP sem a coluna `c_orgao` (dropdown, não vinculada) esperada pelo teste.');
    }
    orgColumn = found;

    const members = await api.get<{ data: Member[] }>('/v1/members', { token: ana });
    anaUserId = members.body.data.find((member) => member.email === USERS.ana)?.userId ?? '';

    const current = await api.patch<WorkspaceDto>(`/v1/workspaces/${workspaceId}`, { token: ana, body: {} });
    originalModules = current.body.enabledModules;
    await api.patch(`/v1/workspaces/${workspaceId}`, {
      token: ana,
      body: { enabledModules: [...originalModules, 'ai'] },
    });

    // Só `ana` pode ver a coluna `c_orgao` — base do teste do critério de aceite 1.
    await api.patch(`/v1/boards/${boardId}/columns/${orgColumn.id}`, {
      token: ana,
      body: { permissions: { viewers: { userIds: [anaUserId] } } },
    });

    const provider = server.app.get<AiProviderClient>(AI_PROVIDER_CLIENT);
    completeSpy = vi.fn<AiProviderClient['complete']>();
    provider.complete = completeSpy;
  });

  afterEach(() => {
    completeSpy.mockReset();
  });

  afterAll(async () => {
    await api.patch(`/v1/boards/${boardId}/columns/${orgColumn.id}`, { token: ana, body: { permissions: {} } });
    await api.patch(`/v1/workspaces/${workspaceId}`, { token: ana, body: { enabledModules: originalModules } });
    await db.close();
    await server.close();
  });

  describe('módulo opcional `ai` (ADR 0017)', () => {
    it('workspace sem o módulo `ai` ativo: rotas do módulo somem (404)', async () => {
      await api.patch(`/v1/workspaces/${workspaceId}`, { token: ana, body: { enabledModules: originalModules } });
      try {
        const assistant = await api.post(`/v1/boards/${boardId}/ai/assistant`, {
          token: ana,
          body: { question: 'oi' },
        });
        expect(assistant.status).toBe(404);
        const predictions = await api.get(`/v1/boards/${boardId}/ai/predictions`, { token: ana });
        expect(predictions.status).toBe(404);
      } finally {
        await api.patch(`/v1/workspaces/${workspaceId}`, {
          token: ana,
          body: { enabledModules: [...originalModules, 'ai'] },
        });
      }
    });
  });

  describe('IA não configurada / limite de uso (checados ANTES de chamar o provedor)', () => {
    it('tenant sem `ai_settings.enabled`/chave: responde `ai_not_configured` e não chama o provedor', async () => {
      const response = await api.post<ProblemBody>(`/v1/boards/${boardId}/ai/assistant`, {
        token: ana,
        body: { question: 'Quantos itens existem?' },
      });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('ai_not_configured');
      expect(completeSpy).not.toHaveBeenCalled();
    });

    it('PATCH /v1/ai/settings habilita a IA e cifra a chave — nunca devolvida em texto puro', async () => {
      const forbidden = await api.patch('/v1/ai/settings', { token: thiago, body: { enabled: true } });
      expect(forbidden.status).toBe(403);

      const response = await api.patch<AiSettingsResponse>('/v1/ai/settings', {
        token: ana,
        body: { enabled: true, apiKey: 'sk-test-0123456789abcdef', model: 'claude-haiku-5-5' },
      });
      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.body.hasApiKey).toBe(true);
      expect(response.body.model).toBe('claude-haiku-5-5');
      expect(JSON.stringify(response.body)).not.toContain('sk-test-0123456789abcdef');

      const get = await api.get<AiSettingsResponse>('/v1/ai/settings', { token: ana });
      expect(get.status).toBe(200);
      expect(get.body.hasApiKey).toBe(true);
    });

    it('limite mensal de uso estourado: erro ANTES de qualquer chamada à Anthropic', async () => {
      await api.patch('/v1/ai/settings', { token: ana, body: { monthlyTokenLimit: 100 } });
      await db.db.insert(aiUsageLogs).values({
        tenantId: DEMO_TENANT_ID,
        userId: null,
        feature: 'assistant',
        model: 'claude-haiku-5-5',
        inputTokens: 100,
        outputTokens: 0,
        costCents: 1,
      });
      try {
        const response = await api.post<ProblemBody>(`/v1/boards/${boardId}/ai/assistant`, {
          token: ana,
          body: { question: 'oi' },
        });
        expect(response.status).toBe(422);
        expect(response.body.code).toBe('ai_usage_limit_exceeded');
        expect(completeSpy).not.toHaveBeenCalled();
      } finally {
        await db.db.delete(aiUsageLogs).where(eq(aiUsageLogs.tenantId, DEMO_TENANT_ID));
        await api.patch('/v1/ai/settings', { token: ana, body: { monthlyTokenLimit: null } });
      }
    });

    it('GET /v1/ai/settings/usage soma o uso do mês corrente por funcionalidade', async () => {
      await db.db.insert(aiUsageLogs).values({
        tenantId: DEMO_TENANT_ID,
        userId: null,
        feature: 'summary',
        model: 'claude-haiku-5-5',
        inputTokens: 30,
        outputTokens: 10,
        costCents: 2,
      });
      try {
        const response = await api.get<{ data: { feature: string; tokens: number; calls: number }[] }>(
          '/v1/ai/settings/usage',
          { token: ana },
        );
        expect(response.status).toBe(200);
        const summary = response.body.data.find((entry) => entry.feature === 'summary');
        expect(summary).toBeDefined();
        expect(summary?.tokens).toBeGreaterThanOrEqual(40);
        expect(summary?.calls).toBeGreaterThanOrEqual(1);
      } finally {
        await db.db.delete(aiUsageLogs).where(eq(aiUsageLogs.tenantId, DEMO_TENANT_ID));
      }
    });
  });

  describe('Assistente — nunca retorna dado que o usuário não tem permissão de ver (critério de aceite 1)', () => {
    let secretItemId: string;
    // O "segredo" é o rótulo da opção escolhida na coluna restrita (`c_orgao`), não um texto livre.
    let secret: string;

    beforeAll(async () => {
      const option = orgColumn.options[0];
      if (option === undefined) throw new Error('`c_orgao` sem opções.');
      secret = option.label;
      const groupId = board.groups[0]?.id ?? '';
      const created = await api.post<Item>(`/v1/boards/${boardId}/items`, {
        token: ana,
        body: {
          groupId,
          name: 'Item com dado restrito',
          values: { ...requiredValues(board), [orgColumn.key]: { optionIds: [option.id] } },
        },
      });
      expect(created.status).toBe(201);
      secretItemId = created.body.id;
    });

    afterAll(async () => {
      await api.delete(`/v1/items/${secretItemId}`, { token: ana });
    });

    it('a ferramenta `get_item` nunca inclui a coluna restrita no prompt quando quem pergunta não pode vê-la', async () => {
      completeSpy
        .mockImplementationOnce(() => Promise.resolve(toolCallResult('get_item', { itemId: secretItemId })))
        .mockImplementationOnce(() => Promise.resolve(textResult('Não encontrei essa informação.')));

      const response = await api.post<AssistantResponse>(`/v1/boards/${boardId}/ai/assistant`, {
        token: rafael,
        body: { question: 'Qual é o órgão deste item?' },
      });
      expect(response.status).toBe(200);
      expect(response.body.toolCalls).toContain('get_item');

      expect(completeSpy).toHaveBeenCalledTimes(2);
      const toolResultBlock = secondCallToolResult(completeSpy);
      expect(toolResultBlock.content).not.toContain(secret);
      expect(toolResultBlock.content).not.toContain(orgColumn.title);
    });

    it('a mesma ferramenta, para quem TEM permissão na coluna, devolve o valor normalmente', async () => {
      completeSpy
        .mockImplementationOnce(() => Promise.resolve(toolCallResult('get_item', { itemId: secretItemId })))
        .mockImplementationOnce(() => Promise.resolve(textResult('O valor é esse.')));

      const response = await api.post<AssistantResponse>(`/v1/boards/${boardId}/ai/assistant`, {
        token: ana,
        body: { question: 'Qual é o valor do campo de texto deste item?' },
      });
      expect(response.status).toBe(200);
      expect(secondCallToolResult(completeSpy).content).toContain(secret);
    });

    it('perguntar sobre um item que o usuário não pode nem ler devolve um erro da ferramenta, nunca o conteúdo', async () => {
      completeSpy
        .mockImplementationOnce(() => Promise.resolve(toolCallResult('get_item', { itemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })))
        .mockImplementationOnce(() => Promise.resolve(textResult('Não encontrei esse item.')));

      const response = await api.post<AssistantResponse>(`/v1/boards/${boardId}/ai/assistant`, {
        token: rafael,
        body: { question: 'Me fale sobre o item ffffffff-ffff-4fff-8fff-ffffffffffff' },
      });
      expect(response.status).toBe(200);
      expect(secondCallToolResult(completeSpy).isError).toBe(true);
    });
  });

  describe('Criação de item a partir de texto livre', () => {
    it('a IA só decide o texto por coluna; a conversão usa `parseCellText` (determinística)', async () => {
      const option = orgColumn.options[1];
      if (option === undefined) throw new Error('`c_orgao` sem opção suficiente para o teste.');
      // O board tem outra coluna obrigatória (`c_frente`, status) — sem preenchê-la a criação do item
      // falharia por regra do próprio board (`required_fields_missing`), nada a ver com a IA.
      const requiredColumns = Object.fromEntries(
        Object.entries(requiredValues(board)).map(([key, value]) => {
          const label =
            typeof value === 'object' && value !== null && 'text' in value
              ? (value as { text: string }).text
              : (board.columns.find((column) => column.key === key)?.labels[0]?.label ??
                board.columns.find((column) => column.key === key)?.options[0]?.label ??
                '');
          return [key, label];
        }),
      );
      completeSpy.mockImplementationOnce(() =>
        Promise.resolve(
          extractToolCallResult({
            name: 'Item criado via texto livre',
            // A IA devolve o texto bruto (o rótulo da opção, como aparece no documento) — não o id;
            // quem resolve "SMIT" → optionId é `parseCellText`, nunca o modelo.
            columns: { ...requiredColumns, [orgColumn.key]: option.label },
          }),
        ),
      );
      const groupId = board.groups[0]?.id ?? '';
      const response = await api.post<{ item: Item; skippedColumns: string[] }>(`/v1/boards/${boardId}/ai/create-item`, {
        token: ana,
        body: { text: 'Criar uma tarefa para revisar o documento X.', groupId },
      });
      expect(response.status).toBe(201);
      expect(response.body.item.values[orgColumn.key]?.optionIds).toEqual([option.id]);
      expect(response.body.skippedColumns).not.toContain(orgColumn.key);
      await api.delete(`/v1/items/${response.body.item.id}`, { token: ana });
    });
  });

  describe('Agentes de IA — toda ação fica registrada e pode ser revertida (critério de aceite 2)', () => {
    let agentId: string;
    let itemId: string;

    const beforeOption = (): { id: string; label: string } => {
      const option = orgColumn.options[0];
      if (option === undefined) throw new Error('`c_orgao` sem opções.');
      return option;
    };
    const afterOption = (): { id: string; label: string } => {
      const option = orgColumn.options[1];
      if (option === undefined) throw new Error('`c_orgao` sem opção suficiente.');
      return option;
    };

    beforeAll(async () => {
      const groupId = board.groups[0]?.id ?? '';
      const created = await api.post<Item>(`/v1/boards/${boardId}/items`, {
        token: ana,
        body: {
          groupId,
          name: 'Item para agente de IA',
          values: { ...requiredValues(board), [orgColumn.key]: { optionIds: [beforeOption().id] } },
        },
      });
      itemId = created.body.id;
      const agent = await api.post<AiAgent>(`/v1/boards/${boardId}/ai-agents`, {
        token: ana,
        body: {
          name: 'Agente de teste (e2e)',
          instructions: 'Preencher a coluna de texto quando um item for criado.',
          trigger: { type: 'item_created', config: {} },
          allowedActions: ['set_column_value'],
        },
      });
      expect(agent.status).toBe(201);
      agentId = agent.body.id;
    });

    afterAll(async () => {
      await api.delete(`/v1/ai-agents/${agentId}`, { token: ana });
      await api.delete(`/v1/items/${itemId}`, { token: ana });
    });

    it('CRUD: lista, atualiza e (no fim) exclui o agente', async () => {
      const forbidden = await api.post(`/v1/boards/${boardId}/ai-agents`, {
        token: thiago,
        body: {
          name: 'x',
          instructions: 'x',
          trigger: { type: 'item_created', config: {} },
          allowedActions: ['notify'],
        },
      });
      expect(forbidden.status).toBe(403);

      const list = await api.get<{ data: AiAgent[] }>(`/v1/boards/${boardId}/ai-agents`, { token: ana });
      expect(list.body.data.some((entry) => entry.id === agentId)).toBe(true);

      const updated = await api.patch<AiAgent>(`/v1/ai-agents/${agentId}`, { token: ana, body: { isActive: false } });
      expect(updated.status).toBe(200);
      expect(updated.body.isActive).toBe(false);
      await api.patch(`/v1/ai-agents/${agentId}`, { token: ana, body: { isActive: true } });
    });

    it('aprovar executa a ação de verdade com auditoria; reverter desfaz e audita de novo', async () => {
      const [run] = await db.db
        .insert(aiAgentRuns)
        .values({
          tenantId: DEMO_TENANT_ID,
          agentId,
          boardId,
          itemId,
          status: 'pending_approval',
          reasoning: 'O órgão estava com um valor de teste; proponho atualizar.',
          proposedAction: {
            type: 'set_column_value',
            config: { columnKey: orgColumn.key, value: { optionIds: [afterOption().id] } },
          },
        })
        .returning();
      expect(run).toBeDefined();
      const runId = run?.id ?? '';

      const forbidden = await api.post(`/v1/ai-agent-runs/${runId}/approve`, { token: thiago, body: {} });
      expect(forbidden.status).toBe(403);

      const approved = await api.post<AiAgentRun>(`/v1/ai-agent-runs/${runId}/approve`, {
        token: ana,
        body: { note: 'aprovado no teste' },
      });
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe('executed');

      const afterApprove = await api.get<Item>(`/v1/items/${itemId}`, { token: ana });
      expect(afterApprove.body.values[orgColumn.key]?.optionIds).toEqual([afterOption().id]);

      const auditRows = await db.db.execute<{ action: string; actor_kind: string; metadata: Record<string, unknown> }>(
        sql`select action, actor_kind, metadata from audit_logs
            where tenant_id = ${DEMO_TENANT_ID}::uuid and entity_id = ${itemId}::uuid
            order by chain_seq`,
      );
      const itemUpdateAudit = auditRows.rows.filter((row) => row.action === 'item.updated');
      expect(itemUpdateAudit.length).toBeGreaterThan(0);
      expect(itemUpdateAudit.at(-1)?.actor_kind).toBe('automation');

      const agentRunAudit = await db.db.execute<{ metadata: { agentId?: string; runId?: string; source?: string } }>(
        sql`select metadata from audit_logs
            where tenant_id = ${DEMO_TENANT_ID}::uuid and entity_type = 'ai_agent_run' and entity_id = ${runId}::uuid`,
      );
      expect(agentRunAudit.rows.some((row) => row.metadata.source === 'ai_agent' && row.metadata.runId === runId)).toBe(
        true,
      );

      const countBeforeRevert = auditRows.rows.length;

      const notRevertibleBeforeExecution = await api.post(`/v1/ai-agent-runs/${runId}/approve`, { token: ana, body: {} });
      expect(notRevertibleBeforeExecution.status).toBe(409);

      const reverted = await api.post<AiAgentRun>(`/v1/ai-agent-runs/${runId}/revert`, { token: ana });
      expect(reverted.status).toBe(200);
      expect(reverted.body.status).toBe('reverted');

      const afterRevert = await api.get<Item>(`/v1/items/${itemId}`, { token: ana });
      expect(afterRevert.body.values[orgColumn.key]?.optionIds).toEqual([beforeOption().id]);

      const auditAfterRevert = await db.db.execute(
        sql`select action from audit_logs where tenant_id = ${DEMO_TENANT_ID}::uuid and entity_id = ${itemId}::uuid`,
      );
      expect(auditAfterRevert.rows.length).toBeGreaterThan(countBeforeRevert);

      const secondRevert = await api.post(`/v1/ai-agent-runs/${runId}/revert`, { token: ana });
      expect(secondRevert.status).toBe(409);
    });

    it('rejeitar não executa nada', async () => {
      const [run] = await db.db
        .insert(aiAgentRuns)
        .values({
          tenantId: DEMO_TENANT_ID,
          agentId,
          boardId,
          itemId,
          status: 'pending_approval',
          reasoning: 'proposta descartável',
          proposedAction: { type: 'notify', config: { message: 'teste' } },
        })
        .returning();
      const runId = run?.id ?? '';
      const rejected = await api.post<AiAgentRun>(`/v1/ai-agent-runs/${runId}/reject`, {
        token: ana,
        body: { note: 'não se aplica' },
      });
      expect(rejected.status).toBe(200);
      expect(rejected.body.status).toBe('rejected');

      const runs = await api.get<{ data: AiAgentRun[] }>(`/v1/ai-agents/${agentId}/runs`, { token: ana });
      expect(runs.body.data.some((entry) => entry.id === runId && entry.status === 'rejected')).toBe(true);
    });
  });
});
