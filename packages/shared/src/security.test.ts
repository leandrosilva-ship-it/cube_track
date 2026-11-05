import { describe, expect, it } from 'vitest';

import {
  AccessRestrictionPolicySchema,
  checkAccessRestriction,
  checkPasswordPolicy,
  DEFAULT_PASSWORD_POLICY,
  isEmailDomainAllowed,
  isIpAllowed,
  isPasswordExpired,
  PasswordPolicySchema,
  SamlConfigSchema,
  ScimUserSchema,
  scimListResponse,
  SecurityPolicySchema,
  SessionPolicySchema,
} from './security.js';

describe('política de senha', () => {
  it('aplica os padrões seguros quando nada é informado', () => {
    expect(DEFAULT_PASSWORD_POLICY.minLength).toBe(10);
    expect(DEFAULT_PASSWORD_POLICY.requireSymbol).toBe(false);
    expect(DEFAULT_PASSWORD_POLICY.maxAgeDays).toBeNull();
  });

  it('checkPasswordPolicy aponta cada violação', () => {
    const policy = PasswordPolicySchema.parse({
      minLength: 10,
      requireUppercase: true,
      requireLowercase: true,
      requireDigit: true,
      requireSymbol: true,
    });
    expect(checkPasswordPolicy('abc', policy)).toEqual(
      expect.arrayContaining(['min_length', 'uppercase', 'digit', 'symbol']),
    );
    expect(checkPasswordPolicy('Abcdef123!', policy)).toEqual([]);
  });

  it('isPasswordExpired respeita maxAgeDays (null nunca expira)', () => {
    const policy = PasswordPolicySchema.parse({ maxAgeDays: 90 });
    const now = new Date('2026-01-01T00:00:00Z');
    expect(isPasswordExpired(new Date('2025-01-01T00:00:00Z'), policy, now)).toBe(true);
    expect(isPasswordExpired(new Date('2025-12-15T00:00:00Z'), policy, now)).toBe(false);
    expect(isPasswordExpired(new Date('2000-01-01T00:00:00Z'), DEFAULT_PASSWORD_POLICY, now)).toBe(
      false,
    );
    expect(isPasswordExpired(null, policy, now)).toBe(false);
  });
});

describe('política de sessão', () => {
  it('rejeita limites fora da faixa', () => {
    expect(() => SessionPolicySchema.parse({ maxConcurrentSessions: 0 })).toThrow();
    expect(SessionPolicySchema.parse({}).idleTimeoutMinutes).toBe(480);
  });
});

describe('allowlist de IP/domínio', () => {
  it('aceita CIDRs e domínios; rejeita formato inválido', () => {
    const policy = AccessRestrictionPolicySchema.parse({
      isEnabled: true,
      allowedCidrs: ['10.0.0.0/8', '203.0.113.5'],
      allowedEmailDomains: ['empresa.gov.br'],
    });
    expect(policy.allowedCidrs).toHaveLength(2);
    expect(() =>
      AccessRestrictionPolicySchema.parse({ allowedCidrs: ['not a cidr!'] }),
    ).toThrow();
  });
});

describe('isIpAllowed (CIDR, v4/v6)', () => {
  it('IPv4: casa dentro do bloco, rejeita fora', () => {
    expect(isIpAllowed('10.0.0.5', ['10.0.0.0/8'])).toBe(true);
    expect(isIpAllowed('11.0.0.5', ['10.0.0.0/8'])).toBe(false);
    expect(isIpAllowed('203.0.113.5', ['203.0.113.5'])).toBe(true);
    expect(isIpAllowed('203.0.113.6', ['203.0.113.5'])).toBe(false);
  });

  it('IPv6: casa dentro do bloco, suporta "::"', () => {
    expect(isIpAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(isIpAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
  });

  it('lista vazia nunca permite', () => {
    expect(isIpAllowed('10.0.0.1', [])).toBe(false);
  });
});

describe('isEmailDomainAllowed', () => {
  it('compara o domínio exato, case-insensitive', () => {
    expect(isEmailDomainAllowed('ana@empresa.gov.br', ['empresa.gov.br'])).toBe(true);
    expect(isEmailDomainAllowed('ana@EMPRESA.GOV.BR', ['empresa.gov.br'])).toBe(true);
    expect(isEmailDomainAllowed('ana@outra.com', ['empresa.gov.br'])).toBe(false);
  });
});

describe('checkAccessRestriction', () => {
  it('desabilitada sempre permite', () => {
    expect(checkAccessRestriction('1.2.3.4', 'a@b.com', AccessRestrictionPolicySchema.parse({})))
      .toEqual({ allowed: true, reason: null });
  });

  it('habilitada sem nenhuma regra preenchida bloqueia tudo (fail-safe)', () => {
    const policy = AccessRestrictionPolicySchema.parse({ isEnabled: true });
    expect(checkAccessRestriction('1.2.3.4', 'a@b.com', policy)).toEqual({
      allowed: false,
      reason: 'no_rules_configured',
    });
  });

  it('exige IP E domínio quando ambos configurados', () => {
    const policy = AccessRestrictionPolicySchema.parse({
      isEnabled: true,
      allowedCidrs: ['10.0.0.0/8'],
      allowedEmailDomains: ['empresa.gov.br'],
    });
    expect(checkAccessRestriction('10.1.1.1', 'ana@empresa.gov.br', policy).allowed).toBe(true);
    expect(checkAccessRestriction('200.1.1.1', 'ana@empresa.gov.br', policy)).toEqual({
      allowed: false,
      reason: 'ip_not_allowed',
    });
    expect(checkAccessRestriction('10.1.1.1', 'ana@outra.com', policy)).toEqual({
      allowed: false,
      reason: 'domain_not_allowed',
    });
    expect(checkAccessRestriction(null, 'ana@empresa.gov.br', policy).allowed).toBe(false);
  });
});

describe('SecurityPolicySchema', () => {
  it('compõe senha + sessão + allowlist com padrões independentes', () => {
    const parsed = SecurityPolicySchema.parse({});
    expect(parsed.password.minLength).toBe(10);
    expect(parsed.session.maxConcurrentSessions).toBe(10);
    expect(parsed.accessRestriction.isEnabled).toBe(false);
  });
});

describe('SamlConfigSchema', () => {
  it('exige idpSsoUrl e idpCertificate válidos', () => {
    expect(() =>
      SamlConfigSchema.parse({
        idpEntityId: 'https://idp.exemplo.gov.br',
        idpSsoUrl: 'not-a-url',
        idpCertificate: 'cert',
      }),
    ).toThrow();
    const parsed = SamlConfigSchema.parse({
      idpEntityId: 'https://idp.exemplo.gov.br',
      idpSsoUrl: 'https://idp.exemplo.gov.br/sso',
      idpCertificate: '-----BEGIN CERTIFICATE-----abc-----END CERTIFICATE-----',
    });
    expect(parsed.attributeMapping.email).toBe('email');
    expect(parsed.provisionOnFirstLogin).toBe(true);
    expect(parsed.defaultRoleKey).toBe('guest');
  });
});

describe('SCIM', () => {
  it('ScimUserSchema exige ao menos um e-mail', () => {
    expect(() =>
      ScimUserSchema.parse({ userName: 'ana', emails: [] }),
    ).toThrow();
    const user = ScimUserSchema.parse({
      userName: 'ana@exemplo.gov.br',
      emails: [{ value: 'ana@exemplo.gov.br', primary: true }],
    });
    expect(user.active).toBe(true);
  });

  it('scimListResponse monta o envelope padrão', () => {
    const response = scimListResponse([{ id: '1' }], 1, 1);
    expect(response.totalResults).toBe(1);
    expect(response.Resources).toHaveLength(1);
    expect(response.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:ListResponse']);
  });
});
