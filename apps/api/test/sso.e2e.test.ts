import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { client, DEMO_PASSWORD, resetRateLimits, startApi, USERS, type ApiClient, type ApiServer } from './helpers.js';
import { buildSignedSamlResponse, generateTestIdpCertificate } from './saml-fixtures.js';

interface Session {
  accessToken: string;
  tenant: { id: string; slug: string };
  user: { id: string; email: string };
}

/**
 * SSO SAML 2.0 (ADR 0057) — contra PostgreSQL real sob RLS e contra a verificação de assinatura de
 * verdade do `@node-saml/node-saml` (um certificado/chave autoassinados só de teste, nunca mockados):
 * a resposta SAML é construída e assinada com `xml-crypto`, exatamente como um IdP real faria.
 */
describe('SSO SAML 2.0', () => {
  let server: ApiServer;
  let api: ApiClient;
  let ownerToken: string;
  let tenantSlug: string;
  let idp: { cert: string; key: string };

  beforeAll(async () => {
    server = await startApi();
    api = client(server.url);
    const login = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.ana, password: DEMO_PASSWORD },
    });
    ownerToken = login.body.accessToken;
    tenantSlug = login.body.tenant.slug;
    idp = generateTestIdpCertificate();
  }, 30_000);

  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET config começa desabilitado; exige sso.manage para configurar', async () => {
    const initial = await api.get('/v1/sso/config', { token: ownerToken });
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ isEnabled: false, hasCertificate: false });

    const other = await api.post<Session>('/v1/auth/login', {
      body: { email: USERS.fernanda, password: DEMO_PASSWORD },
    });
    const forbidden = await api.put('/v1/sso/config', {
      token: other.body.accessToken,
      body: { idpEntityId: 'x', idpSsoUrl: 'https://idp.test/sso', idpCertificate: idp.cert },
    });
    expect(forbidden.status).toBe(403);
  });

  it('metadados SP exigem SSO habilitado e cifram o certificado (nunca devolvido em texto puro)', async () => {
    const beforeEnable = await api.get(`/v1/sso/${tenantSlug}/metadata`);
    expect(beforeEnable.status).toBe(404);

    const update = await api.put('/v1/sso/config', {
      token: ownerToken,
      body: {
        isEnabled: true,
        idpEntityId: 'https://idp.test/entity',
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificate: idp.cert,
        attributeMapping: { email: 'email', name: 'name', orgUnit: null },
        provisionOnFirstLogin: true,
        defaultRoleKey: 'guest',
      },
    });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ isEnabled: true, hasCertificate: true });
    expect(JSON.stringify(update.body)).not.toContain('BEGIN CERTIFICATE');

    const metadata = await api.get(`/v1/sso/${tenantSlug}/metadata`);
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get('content-type')).toContain('samlmetadata+xml');

    const login = await api.get(`/v1/sso/${tenantSlug}/login`);
    expect(login.status).toBe(302);
    expect(login.headers.get('location')).toContain('https://idp.test/sso');
  });

  it('ACS: asserção assinada de verdade provisiona um convidado novo (guestItemVisibility: org compatível)', async () => {
    await api.put('/v1/sso/config', {
      token: ownerToken,
      body: {
        isEnabled: true,
        idpEntityId: 'https://idp.test/entity',
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificate: idp.cert,
        attributeMapping: { email: 'email', name: 'name', orgUnit: 'department' },
        provisionOnFirstLogin: true,
        defaultRoleKey: 'guest',
      },
    });
    // A API usa `APP_CONFIG.API_URL` (padrão de teste: http://localhost:3001) para montar o
    // entityId/ACS do SP — não a porta efêmera real do servidor de teste (`server.url`).
    const spEntityId = `http://localhost:3001/v1/sso/${tenantSlug}/metadata`;
    const acsUrl = `http://localhost:3001/v1/sso/${tenantSlug}/acs`;
    const samlResponse = buildSignedSamlResponse({
      idpEntityId: 'https://idp.test/entity',
      spEntityId,
      acsUrl,
      nameId: 'novo.parceiro@orgao.gov.br',
      attributes: { email: 'novo.parceiro@orgao.gov.br', name: 'Parceiro Externo', department: 'Secretaria de Obras' },
      privateKey: idp.key,
      publicCert: idp.cert,
    });

    const acs = await api.post('/v1/sso/' + tenantSlug + '/acs', {
      body: { SAMLResponse: samlResponse },
    });
    expect(acs.status).toBe(302);
    expect(acs.headers.get('location')).toContain('/auth/callback?status=ok');
    const cookie = acs.headers.getSetCookie().find((entry) => entry.startsWith('ct_refresh='));
    expect(cookie).toBeDefined();

    const whoAmI = await api.post<Session>('/v1/auth/refresh', { headers: { cookie: cookie ?? '' } });
    expect(whoAmI.status).toBe(200);
    expect(whoAmI.body.user.email).toBe('novo.parceiro@orgao.gov.br');
    expect(whoAmI.body.tenant.slug).toBe(tenantSlug);
  });

  it('ACS: asserção adulterada (assinatura inválida) é rejeitada, nunca autentica', async () => {
    await api.put('/v1/sso/config', {
      token: ownerToken,
      body: {
        isEnabled: true,
        idpEntityId: 'https://idp.test/entity',
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificate: idp.cert,
        provisionOnFirstLogin: true,
        defaultRoleKey: 'guest',
      },
    });
    // A API usa `APP_CONFIG.API_URL` (padrão de teste: http://localhost:3001) para montar o
    // entityId/ACS do SP — não a porta efêmera real do servidor de teste (`server.url`).
    const spEntityId = `http://localhost:3001/v1/sso/${tenantSlug}/metadata`;
    const acsUrl = `http://localhost:3001/v1/sso/${tenantSlug}/acs`;
    const tampered = buildSignedSamlResponse({
      idpEntityId: 'https://idp.test/entity',
      spEntityId,
      acsUrl,
      nameId: 'vitima@orgao.gov.br',
      attributes: { email: 'vitima@orgao.gov.br', name: 'Vítima' },
      privateKey: idp.key,
      publicCert: idp.cert,
      tamperAfterSigning: true,
    });

    const acs = await api.post('/v1/sso/' + tenantSlug + '/acs', {
      body: { SAMLResponse: tampered },
    });
    expect(acs.status).toBe(302);
    expect(acs.headers.get('location')).toContain('error=');
    expect(acs.headers.getSetCookie()).toEqual([]);
  });

  it('ACS sem conta e sem provisionamento: nega o acesso (fail-safe)', async () => {
    await api.put('/v1/sso/config', {
      token: ownerToken,
      body: {
        isEnabled: true,
        idpEntityId: 'https://idp.test/entity',
        idpSsoUrl: 'https://idp.test/sso',
        idpCertificate: idp.cert,
        provisionOnFirstLogin: false,
        defaultRoleKey: 'guest',
      },
    });
    // A API usa `APP_CONFIG.API_URL` (padrão de teste: http://localhost:3001) para montar o
    // entityId/ACS do SP — não a porta efêmera real do servidor de teste (`server.url`).
    const spEntityId = `http://localhost:3001/v1/sso/${tenantSlug}/metadata`;
    const acsUrl = `http://localhost:3001/v1/sso/${tenantSlug}/acs`;
    const samlResponse = buildSignedSamlResponse({
      idpEntityId: 'https://idp.test/entity',
      spEntityId,
      acsUrl,
      nameId: 'desconhecido@fora.com',
      attributes: { email: 'desconhecido@fora.com', name: 'Desconhecido' },
      privateKey: idp.key,
      publicCert: idp.cert,
    });
    const acs = await api.post('/v1/sso/' + tenantSlug + '/acs', {
      body: { SAMLResponse: samlResponse },
    });
    expect(acs.status).toBe(302);
    expect(acs.headers.get('location')).toContain('error=no_account');
  });
});
