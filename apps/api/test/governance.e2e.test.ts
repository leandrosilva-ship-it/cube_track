import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { client, DEMO_PASSWORD, resetRateLimits, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';

interface Session {
  accessToken: string;
}
interface AuditEntry {
  action: string;
  entityType: string;
}
interface DataSubjectRequest {
  id: string;
  kind: string;
  status: string;
}

/** Auditoria avançada (busca/exportação) e LGPD (consentimento, solicitações de titular) — ADR 0057. */
describe('Governança: auditoria e LGPD', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ownerToken: string;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.ana, password: DEMO_PASSWORD },
    });
    ownerToken = login.body.accessToken;
  });

  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await server.close();
  });

  it('busca de auditoria: paginada, filtra por ação, 403 sem audit.read', async () => {
    const other = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.fernanda, password: DEMO_PASSWORD },
    });
    const forbidden = await api.get('/v1/audit/entries', { token: other.body.accessToken });
    expect(forbidden.status).toBe(403);

    const search = await api.get<{ data: AuditEntry[]; pageInfo: { hasNextPage: boolean } }>(
      '/v1/audit/entries?limit=5',
      { token: ownerToken },
    );
    expect(search.status).toBe(200);
    expect(search.body.data.length).toBeGreaterThan(0);

    const byAction = await api.get<{ data: AuditEntry[] }>(
      `/v1/audit/entries?action=${encodeURIComponent(search.body.data[0]?.action ?? '')}`,
      { token: ownerToken },
    );
    expect(byAction.status).toBe(200);
    expect(byAction.body.data.every((entry) => entry.action === search.body.data[0]?.action)).toBe(true);
  });

  it('exportação em NDJSON e CSV é transmitida em stream, 403 sem audit.export', async () => {
    const other = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.fernanda, password: DEMO_PASSWORD },
    });
    const forbidden = await api.get('/v1/audit/entries/export', { token: other.body.accessToken });
    expect(forbidden.status).toBe(403);

    const ndjson = await fetch(`${server.url}/v1/audit/entries/export?format=ndjson`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ndjson.status).toBe(200);
    expect(ndjson.headers.get('content-type')).toContain('ndjson');
    const ndjsonText = await ndjson.text();
    const lines = ndjsonText.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(() => JSON.parse(lines[0] ?? '') as unknown).not.toThrow();

    const csv = await fetch(`${server.url}/v1/audit/entries/export?format=csv`, {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const csvBytes = new Uint8Array(await csv.arrayBuffer());
    // BOM UTF-8 (0xEF 0xBB 0xBF) antes do cabeçalho — `Response.text()` o removeria (WHATWG strips
    // a leading BOM on decode), então os bytes crus são verificados diretamente.
    expect([csvBytes[0], csvBytes[1], csvBytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvBytes.slice(3));
    expect(csvText.startsWith('id;created_at')).toBe(true);
  });

  it('LGPD: consentimento, exportação própria e fluxo de exclusão (requested → approved → executed)', async () => {
    // Tenant/usuário DESCARTÁVEIS e próprios deste teste (nunca um usuário do seed compartilhado,
    // como USERS.rafael) — a exclusão é IRREVERSÍVEL (anonimiza de verdade) e vazaria para qualquer
    // outro arquivo de teste rodando na mesma suíte (um único banco de teste por execução, não por
    // arquivo). O dono da organização nova decide/executa a própria solicitação (incomum na vida
    // real, mas isola o teste sem precisar de um segundo usuário).
    const email = `titular.lgpd.${Date.now()}@exemplo.com`;
    const signup = await api.post<Session>('/v1/auth/signup', {
      body: {
        name: 'Titular de Teste',
        email,
        password: 'Senha-Descartavel-2026',
        organizationName: 'Org LGPD Teste',
        organizationSlug: `org-lgpd-teste-${Date.now()}`,
      },
    });
    expect(signup.status).toBe(201);
    const adminToken = signup.body.accessToken;

    const consent = await api.post('/v1/me/lgpd/consents', {
      token: adminToken,
      body: { purpose: 'marketing_email', granted: true, policyVersion: '2026-01' },
    });
    expect(consent.status).toBe(201);

    const myConsents = await api.get<{ data: { purpose: string }[] }>('/v1/me/lgpd/consents', {
      token: adminToken,
    });
    expect(myConsents.body.data.some((entry) => entry.purpose === 'marketing_email')).toBe(true);

    const myExport = await api.get<{ profile: { email: string } | null; outOfScope: string[] }>(
      '/v1/me/lgpd/export',
      { token: adminToken },
    );
    expect(myExport.status).toBe(200);
    expect(myExport.body.profile?.email).toBe(email);
    expect(myExport.body.outOfScope.length).toBeGreaterThan(0);

    const erasure = await api.post<DataSubjectRequest>('/v1/me/lgpd/requests', {
      token: adminToken,
      body: { kind: 'erasure', reason: 'Teste automatizado' },
    });
    expect(erasure.status).toBe(201);
    expect(erasure.body.status).toBe('requested');

    const executeTooEarly = await api.post(`/v1/lgpd/requests/${erasure.body.id}/execute`, {
      token: adminToken,
    });
    expect(executeTooEarly.status).toBe(403);

    const decided = await api.post<DataSubjectRequest>(`/v1/lgpd/requests/${erasure.body.id}/decide`, {
      token: adminToken,
      body: { status: 'approved' },
    });
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('approved');

    const executed = await api.post<DataSubjectRequest>(`/v1/lgpd/requests/${erasure.body.id}/execute`, {
      token: adminToken,
    });
    expect(executed.status).toBe(200);
    expect(executed.body.status).toBe('executed');

    const loginAfterErasure = await api.post('/v1/auth/login', {
      body: { email, password: 'Senha-Descartavel-2026' },
    });
    expect(loginAfterErasure.status).toBe(401);
  });
});
