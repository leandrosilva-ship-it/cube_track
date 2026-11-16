import { describe, expect, it } from 'vitest';

import { checkEmailHost, isAllowedEmailHost } from './email-settings-policy.js';

describe('checkEmailHost (checagem de SSRF no host de SMTP do tenant, sem DNS)', () => {
  it('aceita um host público normal', () => {
    expect(checkEmailHost('smtp.resend.com')).toEqual({ allowed: true });
    expect(isAllowedEmailHost('smtp.resend.com')).toBe(true);
  });

  it('rejeita host vazio', () => {
    expect(isAllowedEmailHost('')).toBe(false);
    expect(isAllowedEmailHost('   ')).toBe(false);
  });

  it('rejeita localhost (e subdomínios de localhost)', () => {
    expect(isAllowedEmailHost('localhost')).toBe(false);
    expect(isAllowedEmailHost('LOCALHOST')).toBe(false);
    expect(isAllowedEmailHost('api.localhost')).toBe(false);
  });

  it('rejeita literais de IP privado/loopback/link-local (IPv4)', () => {
    expect(isAllowedEmailHost('127.0.0.1')).toBe(false);
    expect(isAllowedEmailHost('10.0.0.5')).toBe(false);
    expect(isAllowedEmailHost('172.16.3.4')).toBe(false);
    expect(isAllowedEmailHost('172.31.255.255')).toBe(false);
    expect(isAllowedEmailHost('192.168.1.1')).toBe(false);
    expect(isAllowedEmailHost('169.254.169.254')).toBe(false);
  });

  it('não rejeita um IPv4 público fora das faixas privadas', () => {
    expect(isAllowedEmailHost('172.32.0.1')).toBe(true);
    expect(isAllowedEmailHost('8.8.8.8')).toBe(true);
  });

  it('rejeita literais de IP privado/loopback/link-local (IPv6)', () => {
    expect(isAllowedEmailHost('::1')).toBe(false);
    expect(isAllowedEmailHost('fe80::1')).toBe(false);
    expect(isAllowedEmailHost('fc00::1')).toBe(false);
    expect(isAllowedEmailHost('fd12::1')).toBe(false);
  });
});
