import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { QUEUES } from '@cube-track/shared';
import { Queue } from 'bullmq';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { generateTotp } from '../src/modules/identity/domain/totp.js';
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

function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
  };
}

function refreshCookie(headers: Headers): string | undefined {
  return headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('ct_refresh=') && !cookie.startsWith('ct_refresh=;'))
    ?.split(';')[0];
}

/** Provedor OIDC falso (token endpoint + JWKS) para o fluxo Google. */
async function fakeOidcProvider() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { email: string; sub: string; nonce: string; verified: boolean }>();
  const server: Server = createServer((request, response) => {
    if (request.url === '/jwks') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (request.url === '/token' && request.method === 'POST') {
      let raw = '';
      request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      request.on('end', () => {
        const params = new URLSearchParams(raw);
        const grant = codes.get(params.get('code') ?? '');
        if (grant === undefined || params.get('code_verifier') === null) {
          response.writeHead(400).end();
          return;
        }
        void new SignJWT({
          email: grant.email,
          email_verified: grant.verified,
          nonce: grant.nonce,
          name: 'Usuário OAuth',
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuer('https://accounts.google.com')
          .setAudience('google-client-id')
          .setSubject(grant.sub)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey)
          .then((idToken) =>
            response
              .writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify({ id_token: idToken, access_token: 'x' })),
          );
      });
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    codes,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

describe('Autenticação', () => {
  let server: ApiServer;
  let api: ApiClient;
  let emails: Queue;
  let provider: Awaited<ReturnType<typeof fakeOidcProvider>>;

  async function lastEmail(to: string, template: string): Promise<string> {
    const jobs = await emails.getJobs([
      'waiting',
      'delayed',
      'prioritized',
      'completed',
      'failed',
      'active',
    ]);
    const job = jobs
      .filter((entry) => {
        const data = entry.data as { to: string; template: string };
        return data.to === to && data.template === template;
      })
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (job === undefined) throw new Error(`E-mail ${template} para ${to} não encontrado`);
    const link = (job.data as { data: { link: string } }).data.link;
    return new URL(link).searchParams.get('token') ?? '';
  }

  beforeAll(async () => {
    provider = await fakeOidcProvider();
    Object.assign(process.env, {
      OAUTH_GOOGLE_CLIENT_ID: 'google-client-id',
      OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
      OAUTH_GOOGLE_AUTHORIZATION_URL: `${provider.url}/authorize`,
      OAUTH_GOOGLE_TOKEN_URL: `${provider.url}/token`,
      OAUTH_GOOGLE_JWKS_URL: `${provider.url}/jwks`,
    });
    server = await startApi();
    api = client(server.url);
    emails = new Queue(QUEUES.emails, { connection: redisConnection() });
  });

  // Vários cadastros/logins a partir do mesmo IP: zera os limites entre os cenários.
  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await emails.close();
    await server.close();
    await provider.close();
  });

  it('cadastro cria organização com papéis, workspace e sessão de proprietário', async () => {
    const response = await api.post<Session>('/v1/auth/signup', {
      body: {
        name: 'Nova Pessoa',
        email: 'nova.pessoa@exemplo.com',
        password: 'Senha-Segura-2026',
        organizationName: 'Nova Org',
        organizationSlug: 'nova-org',
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.tenant).toMatchObject({ slug: 'nova-org', kind: 'member' });
    expect(refreshCookie(response.headers)).toBeDefined();
    const me = await api.get<{ tenant: { roleKey: string } }>('/v1/me', {
      token: response.body.accessToken,
    });
    expect(me.body.tenant.roleKey).toBe('owner');
    const workspaces = await api.get<{ data: unknown[] }>('/v1/workspaces', {
      token: response.body.accessToken,
    });
    expect(workspaces.body.data).toHaveLength(1);
    expect(await lastEmail('nova.pessoa@exemplo.com', 'email_verification')).not.toBe('');
    const duplicate = await api.post('/v1/auth/signup', {
      body: {
        name: 'Xavier',
        email: 'nova.pessoa@exemplo.com',
        password: 'Senha-Segura-2026',
        organizationName: 'Outra',
        organizationSlug: 'outra-org',
      },
    });
    expect(duplicate.status).toBe(409);
    const weak = await api.post('/v1/auth/signup', {
      body: {
        name: 'X',
        email: 'fraca@exemplo.com',
        password: 'curta',
        organizationName: 'Org',
        organizationSlug: 'org-fraca',
      },
    });
    expect(weak.status).toBe(400);
  });

  it('bloqueia a conta após 5 senhas erradas', async () => {
    await api.post('/v1/auth/signup', {
      body: {
        name: 'Bloqueio',
        email: 'bloqueio@exemplo.com',
        password: 'Senha-Segura-2026',
        organizationName: 'Org Bloqueio',
        organizationSlug: 'org-bloqueio',
      },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        (
          await api.post('/v1/auth/login', {
            body: { email: 'bloqueio@exemplo.com', password: 'Errada-123456' },
          })
        ).status,
      ).toBe(401);
    }
    const locked = await api.post<{ code: string }>('/v1/auth/login', {
      body: { email: 'bloqueio@exemplo.com', password: 'Senha-Segura-2026' },
    });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('account_locked');
  });

  it('rotaciona o refresh token e revoga a família ao detectar reutilização', async () => {
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.rafael, password: DEMO_PASSWORD },
    });
    const first = refreshCookie(login.headers);
    expect(first).toBeDefined();
    const rotated = await api.post<Session>('/v1/auth/refresh', {
      headers: { cookie: first ?? '' },
    });
    expect(rotated.status).toBe(200);
    const second = refreshCookie(rotated.headers);
    expect(second).not.toBe(first);
    // O sucessor circulou: reapresentar o token antigo é reutilização, mesmo dentro da tolerância.
    const third = refreshCookie(
      (await api.post('/v1/auth/refresh', { headers: { cookie: second ?? '' } })).headers,
    );
    expect(third).toBeDefined();
    const reuse = await api.post<{ code: string }>('/v1/auth/refresh', {
      headers: { cookie: first ?? '' },
    });
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('refresh_reused');
    const afterReuse = await api.post<{ code: string }>('/v1/auth/refresh', {
      headers: { cookie: third ?? '' },
    });
    expect(afterReuse.status).toBe(401);
  });

  it('resposta de rotação perdida: reemite a sessão dentro da tolerância e invalida o sucessor', async () => {
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.rafael, password: DEMO_PASSWORD },
    });
    const first = refreshCookie(login.headers);
    const lost = refreshCookie(
      (await api.post('/v1/auth/refresh', { headers: { cookie: first ?? '' } })).headers,
    );
    const retry = await api.post<Session>('/v1/auth/refresh', {
      headers: { cookie: first ?? '' },
    });
    expect(retry.status).toBe(200);
    const current = refreshCookie(retry.headers);
    expect(current).not.toBe(lost);
    const superseded = await api.post<{ code: string }>('/v1/auth/refresh', {
      headers: { cookie: lost ?? '' },
    });
    expect(superseded.status).toBe(401);
    expect(superseded.body.code).toBe('refresh_revoked');
    const next = await api.post<Session>('/v1/auth/refresh', {
      headers: { cookie: current ?? '' },
    });
    expect(next.status).toBe(200);
  });

  it('refresh token no corpo para clientes nativos e logout encerra a sessão', async () => {
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.juliana, password: DEMO_PASSWORD },
      headers: { 'x-refresh-transport': 'body' },
    });
    expect(login.body.refreshToken).toBeDefined();
    const logout = await api.post('/v1/auth/logout', { token: login.body.accessToken });
    expect(logout.status).toBe(204);
    const refresh = await api.post('/v1/auth/refresh', {
      body: { refreshToken: login.body.refreshToken },
    });
    expect(refresh.status).toBe(401);
  });

  it('MFA TOTP: configuração, desafio no login, códigos de recuperação e desativação', async () => {
    const token = await api.login(USERS.thiago);
    const setup = await api.post<{ secret: string; otpauthUri: string }>('/v1/me/mfa/setup', {
      token,
    });
    expect(setup.body.otpauthUri).toContain('otpauth://totp/');
    const wrong = await api.post('/v1/me/mfa/enable', { token, body: { code: '000000' } });
    expect(wrong.status).toBe(401);
    const enabled = await api.post<{ recoveryCodes: string[] }>('/v1/me/mfa/enable', {
      token,
      body: { code: generateTotp(setup.body.secret) },
    });
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    const challenge = await api.post<{ mfaRequired: boolean; challengeToken: string }>(
      '/v1/auth/login',
      {
        body: { email: USERS.thiago, password: DEMO_PASSWORD },
      },
    );
    expect(challenge.body.mfaRequired).toBe(true);
    const viaRecovery = await api.post<Session>('/v1/auth/mfa/verify', {
      body: {
        challengeToken: challenge.body.challengeToken,
        recoveryCode: enabled.body.recoveryCodes[0],
      },
    });
    expect(viaRecovery.status).toBe(200);

    const challenge2 = await api.post<{ challengeToken: string }>('/v1/auth/login', {
      body: { email: USERS.thiago, password: DEMO_PASSWORD },
    });
    const reused = await api.post('/v1/auth/mfa/verify', {
      body: {
        challengeToken: challenge2.body.challengeToken,
        recoveryCode: enabled.body.recoveryCodes[0],
      },
    });
    expect(reused.status).toBe(401);
    const nextStepCode = generateTotp(setup.body.secret, Date.now() + 30_000);
    const viaTotp = await api.post<Session>('/v1/auth/mfa/verify', {
      body: { challengeToken: challenge2.body.challengeToken, code: nextStepCode },
    });
    expect(viaTotp.status).toBe(200);
    const disable = await api.post('/v1/me/mfa/disable', {
      token: viaTotp.body.accessToken,
      body: { code: generateTotp(setup.body.secret, Date.now() - 30_000) },
    });
    expect(disable.status).toBe(204);
  });

  it('magic link: e-mail com token de uso único', async () => {
    const request = await api.post('/v1/auth/magic-link', { body: { email: USERS.carlos } });
    expect(request.status).toBe(202);
    const unknown = await api.post('/v1/auth/magic-link', {
      body: { email: 'ninguem@exemplo.com' },
    });
    expect(unknown.status).toBe(202);
    const token = await lastEmail(USERS.carlos, 'magic_link');
    const login = await api.post<Session>('/v1/auth/magic-link/verify', { body: { token } });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(USERS.carlos);
    const again = await api.post('/v1/auth/magic-link/verify', { body: { token } });
    expect(again.status).toBe(401);
  });

  it('recuperação de senha troca a senha e encerra sessões', async () => {
    const signup = await api.post<Session>('/v1/auth/signup', {
      body: {
        name: 'Reset',
        email: 'reset@exemplo.com',
        password: 'Senha-Antiga-2026',
        organizationName: 'Org Reset',
        organizationSlug: 'org-reset',
      },
    });
    const oldCookie = refreshCookie(signup.headers);
    await api.post('/v1/auth/password/forgot', { body: { email: 'reset@exemplo.com' } });
    const token = await lastEmail('reset@exemplo.com', 'password_reset');
    expect(
      (await api.post('/v1/auth/password/reset', { body: { token, password: 'Senha-Nova-2026' } }))
        .status,
    ).toBe(204);
    expect(
      (await api.post('/v1/auth/refresh', { headers: { cookie: oldCookie ?? '' } })).status,
    ).toBe(401);
    expect(
      (
        await api.post('/v1/auth/login', {
          body: { email: 'reset@exemplo.com', password: 'Senha-Antiga-2026' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api.post('/v1/auth/login', {
          body: { email: 'reset@exemplo.com', password: 'Senha-Nova-2026' },
        })
      ).status,
    ).toBe(200);
  });

  it('convite: novo usuário aceita, entra na organização e troca de organização', async () => {
    const ownerToken = await api.login(USERS.ana);
    const roles = await api.get<{ data: { id: string; key: string; scope: string }[] }>(
      '/v1/roles',
      { token: ownerToken },
    );
    const memberRole = roles.body.data.find(
      (role) => role.scope === 'tenant' && role.key === 'member',
    );
    const created = await api.post('/v1/invitations', {
      token: ownerToken,
      body: { email: 'convidado.novo@exemplo.com', roleId: memberRole?.id },
    });
    expect(created.status).toBe(201);
    const inviteToken = await lastEmail('convidado.novo@exemplo.com', 'invitation');
    const preview = await api.get<{ organization: { slug: string }; accountExists: boolean }>(
      `/v1/invitations/preview/${inviteToken}`,
    );
    expect(preview.body).toMatchObject({
      organization: { slug: 'empresa-demo' },
      accountExists: false,
    });
    const accepted = await api.post<Session>('/v1/invitations/accept', {
      body: { token: inviteToken, name: 'Convidado Novo', password: 'Senha-Convite-2026' },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.tenant.slug).toBe('empresa-demo');

    // O mesmo usuário cria outra organização e alterna entre elas.
    await resetRateLimits();
    await api.post('/v1/auth/signup', {
      body: {
        name: 'Outro',
        email: 'outro.dono@exemplo.com',
        password: 'Senha-Segura-2026',
        organizationName: 'Segunda Org',
        organizationSlug: 'segunda-org',
      },
    });
    const secondOwner = await api.login('outro.dono@exemplo.com', 'Senha-Segura-2026');
    const secondRoles = await api.get<{ data: { id: string; key: string; scope: string }[] }>(
      '/v1/roles',
      { token: secondOwner },
    );
    await api.post('/v1/invitations', {
      token: secondOwner,
      body: {
        email: 'convidado.novo@exemplo.com',
        roleId: secondRoles.body.data.find(
          (role) => role.key === 'member' && role.scope === 'tenant',
        )?.id,
      },
    });
    const secondInvite = await lastEmail('convidado.novo@exemplo.com', 'invitation');
    const joined = await api.post<Session>('/v1/invitations/accept', {
      token: accepted.body.accessToken,
      body: { token: secondInvite },
    });
    expect(joined.status).toBe(200);
    const organizations = await api.get<{ data: { tenantSlug: string }[] }>(
      '/v1/auth/organizations',
      { token: joined.body.accessToken },
    );
    expect(organizations.body.data.map((entry) => entry.tenantSlug).sort()).toEqual([
      'empresa-demo',
      'segunda-org',
    ]);
    const switched = await api.post<Session>('/v1/auth/switch-organization', {
      token: joined.body.accessToken,
      body: { tenantId: accepted.body.tenant.id },
    });
    expect(switched.status).toBe(200);
    expect(switched.body.tenant.slug).toBe('empresa-demo');
    const foreign = await api.post('/v1/auth/switch-organization', {
      token: switched.body.accessToken,
      body: { tenantId: '01920000-0000-7000-8000-00000000abcd' },
    });
    expect(foreign.status).toBe(403);
  });

  it('OAuth (Google): vincula conta existente pelo e-mail verificado e recusa e-mail sem conta', async () => {
    const start = async () => {
      const response = await api.get('/v1/auth/oauth/google', {
        headers: { 'x-tenant': 'empresa-demo' },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(302);
      const location = new URL(response.headers.get('location') ?? '');
      expect(location.searchParams.get('code_challenge_method')).toBe('S256');
      return {
        state: location.searchParams.get('state') ?? '',
        nonce: location.searchParams.get('nonce') ?? '',
      };
    };
    const first = await start();
    provider.codes.set('code-1', {
      email: USERS.rafael,
      sub: 'google-sub-rafael',
      nonce: first.nonce,
      verified: true,
    });
    const callback = await api.get(
      `/v1/auth/oauth/google/callback?code=code-1&state=${first.state}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('http://app.test/auth/callback?status=ok');
    const cookie = refreshCookie(callback.headers);
    const session = await api.post<Session>('/v1/auth/refresh', {
      headers: { cookie: cookie ?? '' },
    });
    expect(session.body.user.email).toBe(USERS.rafael);

    const replay = await api.get(`/v1/auth/oauth/google/callback?code=code-1&state=${first.state}`);
    expect(replay.headers.get('location')).toContain('error=oauth_state_invalid');

    const second = await start();
    provider.codes.set('code-2', {
      email: 'sem.conta@exemplo.com',
      sub: 'google-sub-x',
      nonce: second.nonce,
      verified: true,
    });
    const denied = await api.get(
      `/v1/auth/oauth/google/callback?code=code-2&state=${second.state}`,
    );
    expect(denied.headers.get('location')).toContain('error=no_account');

    const third = await start();
    provider.codes.set('code-3', {
      email: USERS.juliana,
      sub: 'google-sub-j',
      nonce: 'nonce-errado',
      verified: true,
    });
    const badNonce = await api.get(
      `/v1/auth/oauth/google/callback?code=code-3&state=${third.state}`,
    );
    expect(badNonce.headers.get('location')).toContain('error=oauth_invalid_nonce');
  });
});
