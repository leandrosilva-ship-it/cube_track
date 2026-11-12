import { describe, expect, it } from 'vitest';

import { checkWebhookUrl, isAllowedWebhookUrl } from './webhook-url-policy.js';

describe('checkWebhookUrl (checagem de SSRF no cadastro/edição, sem DNS)', () => {
  it('aceita uma URL https pública normal', () => {
    expect(checkWebhookUrl('https://example.com/hooks/cube-track')).toEqual({ allowed: true });
    expect(isAllowedWebhookUrl('https://example.com/hooks/cube-track')).toBe(true);
  });

  it('rejeita esquemas diferentes de http(s)', () => {
    expect(isAllowedWebhookUrl('ftp://example.com/x')).toBe(false);
    expect(isAllowedWebhookUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedWebhookUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejeita localhost (e subdomínios de localhost)', () => {
    expect(isAllowedWebhookUrl('http://localhost:8080/x')).toBe(false);
    expect(isAllowedWebhookUrl('https://LOCALHOST/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://api.localhost/x')).toBe(false);
  });

  it('rejeita literais de IP privado/loopback/link-local (IPv4)', () => {
    expect(isAllowedWebhookUrl('http://127.0.0.1/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://10.0.0.5/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://172.16.3.4/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://192.168.1.1/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('rejeita literais de IP privado/loopback/link-local (IPv6)', () => {
    expect(isAllowedWebhookUrl('http://[::1]/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://[fe80::1]/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://[fc00::1]/x')).toBe(false);
    expect(isAllowedWebhookUrl('http://[::ffff:192.168.1.1]/x')).toBe(false);
  });

  it('rejeita URL malformada', () => {
    const result = checkWebhookUrl('não é uma url');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('devolve o motivo da rejeição', () => {
    expect(checkWebhookUrl('http://127.0.0.1/x').reason).toContain('127.0.0.1');
  });
});
