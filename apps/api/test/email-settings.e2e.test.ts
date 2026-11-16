import { QUEUES } from '@cube-track/shared';
import { Queue } from 'bullmq';
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
  tenant: { id: string };
}

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
  };
}

/** Configuração de SMTP do tenant: host/porta/usuário/senha e remetente, substituindo o SMTP
 * padrão da plataforma para os e-mails dessa organização (ver `apps/worker/src/processors/email.ts`). */
describe('Configuração de SMTP do tenant', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ownerToken: string;
  let tenantId: string;
  let emails: Queue;

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.ana, password: DEMO_PASSWORD },
    });
    ownerToken = login.body.accessToken;
    tenantId = login.body.tenant.id;
    emails = new Queue(QUEUES.emails, { connection: redisConnection() });
  });

  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await emails.close();
    await server.close();
  });

  it('GET devolve o padrão (desabilitado, sem senha) quando nada foi configurado', async () => {
    const response = await api.get('/v1/email/settings', { token: ownerToken });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      enabled: false,
      host: null,
      hasPassword: false,
    });
  });

  it('exige email.manage para ler e escrever', async () => {
    const other = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.fernanda, password: DEMO_PASSWORD },
    });
    const read = await api.get('/v1/email/settings', { token: other.body.accessToken });
    expect(read.status).toBe(403);
    const write = await api.patch('/v1/email/settings', {
      token: other.body.accessToken,
      body: { host: 'smtp.example.com' },
    });
    expect(write.status).toBe(403);
  });

  it('rejeita host privado/loopback (SSRF)', async () => {
    const response = await api.patch('/v1/email/settings', {
      token: ownerToken,
      body: { host: '169.254.169.254', port: 25 },
    });
    expect(response.status).toBe(400);
  });

  it('salva host/porta/usuário/senha/remetente; a leitura nunca devolve a senha', async () => {
    const update = await api.patch('/v1/email/settings', {
      token: ownerToken,
      body: {
        enabled: true,
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        username: 'resend',
        password: 're_segredo_de_teste',
        fromAddress: 'CUBE PROJECT <onboarding@resend.dev>',
      },
    });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({
      enabled: true,
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      username: 'resend',
      hasPassword: true,
      fromAddress: 'CUBE PROJECT <onboarding@resend.dev>',
    });
    expect(JSON.stringify(update.body)).not.toContain('re_segredo_de_teste');

    const read = await api.get('/v1/email/settings', { token: ownerToken });
    expect(read.body).toMatchObject({ enabled: true, host: 'smtp.resend.com', hasPassword: true });
    expect(JSON.stringify(read.body)).not.toContain('re_segredo_de_teste');

    // Omitir "password" mantém a senha atual (não limpa).
    const keepsPassword = await api.patch('/v1/email/settings', {
      token: ownerToken,
      body: { fromAddress: 'CUBE PROJECT <outro@resend.dev>' },
    });
    expect(keepsPassword.body).toMatchObject({ hasPassword: true, fromAddress: 'CUBE PROJECT <outro@resend.dev>' });

    // Restaura para não vazar estado entre os testes deste arquivo.
    await api.patch('/v1/email/settings', {
      token: ownerToken,
      body: { enabled: false, password: null },
    });
  });

  it('e-mail de teste é enfileirado para o próprio usuário, com o tenantId correto', async () => {
    const response = await api.post('/v1/email/settings/test', { token: ownerToken, body: {} });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ status: 'queued' });

    const jobs = await emails.getJobs(['waiting', 'delayed', 'prioritized', 'completed', 'active']);
    const job = jobs
      .filter((entry) => {
        const data = entry.data as { to: string; template: string };
        return data.to === USERS.ana && data.template === 'smtp_test';
      })
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    expect(job).toBeDefined();
    expect((job?.data as { tenantId: string }).tenantId).toBe(tenantId);
  });
});
