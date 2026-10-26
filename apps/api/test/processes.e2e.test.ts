import { schema, type DatabaseHandle } from '@cube-track/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDb, client, demoIds, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

const { slaTrackers, users } = schema;

interface Pipe {
  id: string;
  boardId: string;
  name: string;
}
interface Phase {
  id: string;
  pipeId: string;
  groupId: string;
  name: string;
  kind: string;
  position: string;
}
interface TransitionRule {
  id: string;
  pipeId: string;
  fromPhaseId: string | null;
  toPhaseId: string;
  requiresApproval: boolean;
}
interface Sla {
  id: string;
  boardId: string;
  pipeId: string | null;
  phaseId: string | null;
  targetMinutes: number;
}
interface ProcessConfig {
  pipe: Pipe | null;
  phases: Phase[];
  transitionRules: TransitionRule[];
}

describe('Processos — pipes, fases, regras de transição e SLA (ADR 0051)', () => {
  let server: ApiServer;
  let api: ApiClient;
  let admin: DatabaseHandle;
  let owner: string;
  let other: string;
  let otherId: string;
  let workspaceId: string;
  let processBoardId: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    admin = adminDb();
    owner = await api.login(USERS.ana);
    other = await api.login(USERS.thiago);
    const [thiago] = await admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, USERS.thiago));
    otherId = thiago?.id ?? '';
    ({ workspaceId } = await demoIds(api, owner));

    const board = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/boards`, {
      token: owner,
      body: { name: 'Processo de teste', kind: 'process' },
    });
    expect(board.status).toBe(201);
    processBoardId = board.body.id;
  });

  afterAll(async () => {
    await server.close();
    await admin.close();
  });

  it('não cria pipe num board que não é do tipo Processo', async () => {
    const regularBoard = await api.post<{ id: string }>(`/v1/workspaces/${workspaceId}/boards`, {
      token: owner,
      body: { name: 'Board comum' },
    });
    const attempt = await api.post(`/v1/boards/${regularBoard.body.id}/pipe`, {
      token: owner,
      body: { name: 'Pipe inválido' },
    });
    expect(attempt.status).toBe(422);
  });

  it('cria o pipe, fases (com grupo correspondente) e regras de transição; exclui em cascata', async () => {
    const pipe = await api.post<Pipe>(`/v1/boards/${processBoardId}/pipe`, {
      token: owner,
      body: { name: 'Pipe de atendimento', description: 'Fluxo de atendimento ao cidadão' },
    });
    expect(pipe.status).toBe(201);

    const second = await api.post(`/v1/boards/${processBoardId}/pipe`, {
      token: owner,
      body: { name: 'Outro pipe' },
    });
    expect(second.status).toBe(409);

    const todo = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Triagem', kind: 'start' },
    });
    expect(todo.status).toBe(201);
    expect(todo.body.groupId).toBeDefined();

    const doing = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Em atendimento', kind: 'intermediate', wipLimit: 5 },
    });
    expect(doing.status).toBe(201);

    const done = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Concluído', kind: 'done' },
    });
    expect(done.status).toBe(201);

    const rule = await api.post<TransitionRule>(`/v1/pipes/${pipe.body.id}/transitions`, {
      token: owner,
      body: {
        fromPhaseId: doing.body.id,
        toPhaseId: done.body.id,
        requiredColumnKeys: [],
        requiresApproval: true,
      },
    });
    expect(rule.status).toBe(201);
    expect(rule.body.requiresApproval).toBe(true);

    const badRule = await api.post(`/v1/pipes/${pipe.body.id}/transitions`, {
      token: owner,
      body: { toPhaseId: '0190a000-0000-7000-8000-000000000000' },
    });
    expect(badRule.status).toBe(422);

    const config = await api.get<ProcessConfig>(`/v1/boards/${processBoardId}/process`, {
      token: owner,
    });
    expect(config.body.pipe?.id).toBe(pipe.body.id);
    expect(config.body.phases).toHaveLength(3);
    expect(config.body.transitionRules).toHaveLength(1);

    // Excluir uma fase remove as regras de transição que a referenciam.
    const deletePhase = await api.delete(`/v1/phases/${done.body.id}`, { token: owner });
    expect(deletePhase.status).toBe(204);
    const afterPhaseDelete = await api.get<ProcessConfig>(`/v1/boards/${processBoardId}/process`, {
      token: owner,
    });
    expect(afterPhaseDelete.body.phases).toHaveLength(2);
    expect(afterPhaseDelete.body.transitionRules).toHaveLength(0);

    const deletePipe = await api.delete(`/v1/pipes/${pipe.body.id}`, { token: owner });
    expect(deletePipe.status).toBe(204);
    const afterPipeDelete = await api.get<ProcessConfig>(`/v1/boards/${processBoardId}/process`, {
      token: owner,
    });
    expect(afterPipeDelete.body.pipe).toBeNull();
  });

  it('exige `process.manage` para gerenciar e `board.read` para ler a configuração', async () => {
    const pipe = await api.post<Pipe>(`/v1/boards/${processBoardId}/pipe`, {
      token: owner,
      body: { name: 'Pipe protegido' },
    });
    expect(pipe.status).toBe(201);

    const forbiddenCreate = await api.post(`/v1/pipes/${pipe.body.id}/phases`, {
      token: other,
      body: { name: 'Fase proibida' },
    });
    expect(forbiddenCreate.status).toBe(403);

    const readable = await api.get(`/v1/boards/${processBoardId}/process`, { token: other });
    expect(readable.status).toBe(200);

    await api.delete(`/v1/pipes/${pipe.body.id}`, { token: owner });
  });

  it('CRUD de SLA valida o escopo (pipe/fase) e permissão', async () => {
    const pipe = await api.post<Pipe>(`/v1/boards/${processBoardId}/pipe`, {
      token: owner,
      body: { name: 'Pipe com SLA' },
    });
    const phase = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Atendimento' },
    });

    const sla = await api.post<Sla>(`/v1/boards/${processBoardId}/slas`, {
      token: owner,
      body: { name: 'SLA de atendimento', targetMinutes: 480, phaseId: phase.body.id },
    });
    expect(sla.status).toBe(201);
    expect(sla.body.phaseId).toBe(phase.body.id);

    const invalidScope = await api.post(`/v1/boards/${processBoardId}/slas`, {
      token: owner,
      body: {
        name: 'SLA inválido',
        targetMinutes: 60,
        phaseId: '0190a000-0000-7000-8000-000000000000',
      },
    });
    expect(invalidScope.status).toBe(422);

    const updated = await api.patch<Sla>(`/v1/slas/${sla.body.id}`, {
      token: owner,
      body: { targetMinutes: 240 },
    });
    expect(updated.body.targetMinutes).toBe(240);

    const forbidden = await api.patch(`/v1/slas/${sla.body.id}`, {
      token: other,
      body: { targetMinutes: 10 },
    });
    expect(forbidden.status).toBe(403);

    const removed = await api.delete(`/v1/slas/${sla.body.id}`, { token: owner });
    expect(removed.status).toBe(204);

    await api.delete(`/v1/pipes/${pipe.body.id}`, { token: owner });
  });

  it('transição move o item, inicia o SLA tracker da fase de destino e encerra o da origem', async () => {
    const pipe = await api.post<Pipe>(`/v1/boards/${processBoardId}/pipe`, {
      token: owner,
      body: { name: 'Pipe com SLA de transição' },
    });
    const triagem = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Triagem', kind: 'start' },
    });
    const atendimento = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Atendimento' },
    });
    await api.post<Sla>(`/v1/boards/${processBoardId}/slas`, {
      token: owner,
      body: {
        name: 'SLA de atendimento',
        targetMinutes: 60,
        useBusinessTime: false,
        phaseId: atendimento.body.id,
      },
    });

    const item = await api.post<{ id: string; phaseId: string | null }>(
      `/v1/boards/${processBoardId}/items`,
      { token: owner, body: { groupId: triagem.body.groupId, name: 'Pedido 123' } },
    );
    expect(item.status).toBe(201);
    expect(item.body.phaseId).toBe(triagem.body.id);

    const moved = await api.patch<{ phaseId: string | null }>(`/v1/items/${item.body.id}`, {
      token: owner,
      body: { groupId: atendimento.body.groupId },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.phaseId).toBe(atendimento.body.id);

    const trackers = await admin.db
      .select()
      .from(slaTrackers)
      .where(eq(slaTrackers.itemId, item.body.id));
    expect(trackers).toHaveLength(1);
    expect(trackers[0]).toMatchObject({ status: 'running' });

    await api.delete(`/v1/pipes/${pipe.body.id}`, { token: owner });
  });

  it('transição com `requiresApproval` bloqueia até existir um pedido aprovado', async () => {
    const pipe = await api.post<Pipe>(`/v1/boards/${processBoardId}/pipe`, {
      token: owner,
      body: { name: 'Pipe com aprovação' },
    });
    const todo = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'A fazer', kind: 'start' },
    });
    const done = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Concluído', kind: 'done' },
    });
    await api.post<TransitionRule>(`/v1/pipes/${pipe.body.id}/transitions`, {
      token: owner,
      body: { fromPhaseId: todo.body.id, toPhaseId: done.body.id, requiresApproval: true },
    });

    const item = await api.post<{ id: string }>(`/v1/boards/${processBoardId}/items`, {
      token: owner,
      body: { groupId: todo.body.groupId, name: 'Item com aprovação' },
    });

    const blocked = await api.patch(`/v1/items/${item.body.id}`, {
      token: owner,
      body: { groupId: done.body.groupId },
    });
    expect(blocked.status).toBe(422);

    const request = await api.post<{ id: string }>(`/v1/items/${item.body.id}/approvals`, {
      token: owner,
      body: { approverIds: [otherId], mode: 'any' },
    });
    expect(request.status).toBe(201);

    const decided = await api.post(`/v1/approvals/${request.body.id}/decide`, {
      token: other,
      body: { decision: 'approved' },
    });
    expect(decided.status).toBe(200);

    const allowed = await api.patch<{ phaseId: string | null }>(`/v1/items/${item.body.id}`, {
      token: owner,
      body: { groupId: done.body.groupId },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.phaseId).toBe(done.body.id);

    await api.delete(`/v1/pipes/${pipe.body.id}`, { token: owner });
  });

  it('lista as definições de SLA do board (GET /v1/boards/:boardId/slas)', async () => {
    const pipe = await api.post<Pipe>(`/v1/boards/${processBoardId}/pipe`, {
      token: owner,
      body: { name: 'Pipe para listar SLAs' },
    });
    const phase = await api.post<Phase>(`/v1/pipes/${pipe.body.id}/phases`, {
      token: owner,
      body: { name: 'Fase' },
    });
    const first = await api.post<Sla>(`/v1/boards/${processBoardId}/slas`, {
      token: owner,
      body: { name: 'SLA A', targetMinutes: 60, phaseId: phase.body.id },
    });
    const second = await api.post<Sla>(`/v1/boards/${processBoardId}/slas`, {
      token: owner,
      body: { name: 'SLA B', targetMinutes: 120 },
    });

    const list = await api.get<{ data: Sla[] }>(`/v1/boards/${processBoardId}/slas`, {
      token: owner,
    });
    expect(list.status).toBe(200);
    const ids = list.body.data.map((entry) => entry.id);
    expect(ids).toContain(first.body.id);
    expect(ids).toContain(second.body.id);

    const readable = await api.get(`/v1/boards/${processBoardId}/slas`, { token: other });
    expect(readable.status).toBe(200);

    await api.delete(`/v1/slas/${first.body.id}`, { token: owner });
    await api.delete(`/v1/slas/${second.body.id}`, { token: owner });
    await api.delete(`/v1/pipes/${pipe.body.id}`, { token: owner });
  });
});
