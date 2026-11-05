import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  client,
  DEMO_PASSWORD,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

interface Session {
  accessToken: string;
  refreshToken?: string;
  sessionId: string;
  tenant: { id: string; slug: string; kind: string };
  user: { id: string; email: string };
}

/**
 * Política de segurança do tenant (ADR 0057): senha, sessão e allowlist de IP/domínio. Cobre o
 * cenário de DoD "login rejeitado pela política" (allowlist de domínio) e o histórico/complexidade de
 * senha configuráveis — fim a fim, contra PostgreSQL real sob RLS (nenhum BYPASSRLS).
 */
describe('Política de segurança', () => {
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

  it('GET devolve os padrões seguros quando nada foi configurado', async () => {
    const response = await api.get('/v1/security/policy', { token: ownerToken });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      password: { minLength: 10, requireSymbol: false },
      session: { maxConcurrentSessions: 10 },
      accessRestriction: { isEnabled: false },
    });
  });

  it('exige security_policy.manage para escrever', async () => {
    const other = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.fernanda, password: DEMO_PASSWORD },
    });
    const response = await api.patch('/v1/security/policy', {
      token: other.body.accessToken,
      body: { password: { minLength: 14 } },
    });
    expect(response.status).toBe(403);
  });

  it('allowlist de domínio: login de domínio não permitido é bloqueado com 403 RFC 7807', async () => {
    const update = await api.patch('/v1/security/policy', {
      token: ownerToken,
      body: {
        accessRestriction: { isEnabled: true, allowedEmailDomains: ['nao-e-este-dominio.example'] },
      },
    });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
      accessRestriction: { isEnabled: true, allowedEmailDomains: ['nao-e-este-dominio.example'] },
    });

    const blocked = await api.post<{ type: string; code: string }>('/v1/auth/login', {
      body: { email: USERS.ana, password: DEMO_PASSWORD },
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('access_restricted');

    // Restaura para não vazar estado entre os testes deste arquivo.
    await api.patch('/v1/security/policy', {
      token: ownerToken,
      body: { accessRestriction: { isEnabled: false, allowedEmailDomains: [] } },
    });
    const restored = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.ana, password: DEMO_PASSWORD },
    });
    expect(restored.status).toBe(200);
  });

  it('política de senha do tenant: complexidade configurável e histórico (não reutilizar)', async () => {
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.carlos, password: DEMO_PASSWORD },
    });
    expect(login.status).toBe(200);
    const token = login.body.accessToken;

    await api.patch('/v1/security/policy', {
      token: ownerToken,
      body: { password: { minLength: 14, requireSymbol: true, historyCount: 1 } },
    });

    // Sem símbolo: viola a política configurável do tenant (não só a base).
    const weak = await api.post('/v1/me/password', {
      token,
      body: { currentPassword: DEMO_PASSWORD, newPassword: 'SenhaSemSimbolo2026' },
    });
    expect(weak.status).toBe(400);

    const strongFirst = 'Senha-Forte#2026';
    const strongSecond = 'Senha-Forte#2027';
    const changed = await api.post('/v1/me/password', {
      token,
      body: { currentPassword: DEMO_PASSWORD, newPassword: strongFirst },
    });
    expect(changed.status).toBe(204);

    const loginFirst = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.carlos, password: strongFirst },
    });
    expect(loginFirst.status).toBe(200);
    const changedAgain = await api.post('/v1/me/password', {
      token: loginFirst.body.accessToken,
      body: { currentPassword: strongFirst, newPassword: strongSecond },
    });
    expect(changedAgain.status).toBe(204);

    // Volta para a senha ANTERIOR (strongFirst) — satisfaz a complexidade, mas viola o histórico
    // (historyCount: 1, a última senha trocada não pode ser reutilizada).
    const loginSecond = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.carlos, password: strongSecond },
    });
    expect(loginSecond.status).toBe(200);
    const reused = await api.post('/v1/me/password', {
      token: loginSecond.body.accessToken,
      body: { currentPassword: strongSecond, newPassword: strongFirst },
    });
    expect(reused.status).toBe(400);

    // Restaura a política padrão e a senha original do seed para não vazar estado entre testes.
    await api.patch('/v1/security/policy', {
      token: ownerToken,
      body: { password: { minLength: 10, requireSymbol: false, historyCount: 5 } },
    });
    const finalChange = await api.post('/v1/me/password', {
      token: loginSecond.body.accessToken,
      body: { currentPassword: strongSecond, newPassword: DEMO_PASSWORD },
    });
    expect(finalChange.status).toBe(204);
  });
});
