import { describe, expect, it, vi } from 'vitest';

import {
  assertAllowedWebhookUrlLiteral,
  assertSafeWebhookUrl,
  isDisallowedIpAddress,
  safeWebhookFetch,
  SsrfBlockedError,
} from '../src/processors/webhook-url-guard.js';

describe('isDisallowedIpAddress', () => {
  it('bloqueia faixas privadas, loopback e link-local (IPv4 e IPv6)', () => {
    expect(isDisallowedIpAddress('10.1.2.3')).toBe(true);
    expect(isDisallowedIpAddress('172.16.5.1')).toBe(true);
    expect(isDisallowedIpAddress('192.168.0.10')).toBe(true);
    expect(isDisallowedIpAddress('127.0.0.1')).toBe(true);
    expect(isDisallowedIpAddress('169.254.169.254')).toBe(true); // metadados de nuvem
    expect(isDisallowedIpAddress('::1')).toBe(true);
    expect(isDisallowedIpAddress('fe80::1')).toBe(true);
    expect(isDisallowedIpAddress('fc00::1')).toBe(true);
  });

  it('bloqueia IPv4-mapped-IPv6 equivalente a um endereço privado', () => {
    expect(isDisallowedIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isDisallowedIpAddress('::ffff:192.168.1.1')).toBe(true);
    expect(isDisallowedIpAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('permite endereços públicos', () => {
    expect(isDisallowedIpAddress('8.8.8.8')).toBe(false);
    expect(isDisallowedIpAddress('93.184.216.34')).toBe(false);
    expect(isDisallowedIpAddress('2606:4700:4700::1111')).toBe(false);
    expect(isDisallowedIpAddress('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('assertAllowedWebhookUrlLiteral (checagem no cadastro, sem DNS)', () => {
  it('aceita uma URL https pública normal', () => {
    expect(() => {
      assertAllowedWebhookUrlLiteral('https://example.com/hooks/cube-track');
    }).not.toThrow();
  });

  it('rejeita esquemas diferentes de http(s)', () => {
    expect(() => {
      assertAllowedWebhookUrlLiteral('ftp://example.com/x');
    }).toThrow(SsrfBlockedError);
    expect(() => {
      assertAllowedWebhookUrlLiteral('file:///etc/passwd');
    }).toThrow(SsrfBlockedError);
    expect(() => {
      assertAllowedWebhookUrlLiteral('gopher://example.com');
    }).toThrow(SsrfBlockedError);
  });

  it('rejeita localhost', () => {
    expect(() => {
      assertAllowedWebhookUrlLiteral('http://localhost:8080/x');
    }).toThrow(SsrfBlockedError);
    expect(() => {
      assertAllowedWebhookUrlLiteral('http://sub.localhost/x');
    }).toThrow(SsrfBlockedError);
  });

  it('rejeita literais de IP privado/loopback/link-local na própria URL', () => {
    expect(() => {
      assertAllowedWebhookUrlLiteral('http://127.0.0.1/x');
    }).toThrow(SsrfBlockedError);
    expect(() => {
      assertAllowedWebhookUrlLiteral('http://10.0.0.5/x');
    }).toThrow(SsrfBlockedError);
    expect(() => {
      assertAllowedWebhookUrlLiteral('http://169.254.169.254/latest/meta-data/');
    }).toThrow(SsrfBlockedError);
    expect(() => {
      assertAllowedWebhookUrlLiteral('http://192.168.1.1/x');
    }).toThrow(SsrfBlockedError);
    expect(() => {
      assertAllowedWebhookUrlLiteral('http://[::1]/x');
    }).toThrow(SsrfBlockedError);
  });

  it('rejeita URL malformada', () => {
    expect(() => {
      assertAllowedWebhookUrlLiteral('não é uma url');
    }).toThrow(SsrfBlockedError);
  });
});

describe('assertSafeWebhookUrl (checagem em tempo de entrega, com resolução DNS)', () => {
  it('aceita um hostname público cuja resolução DNS devolve um endereço público', async () => {
    const resolveHostname = vi.fn().mockResolvedValue(['93.184.216.34']);
    await expect(
      assertSafeWebhookUrl('https://example.com/hooks/cube-track', resolveHostname),
    ).resolves.toBeInstanceOf(URL);
    expect(resolveHostname).toHaveBeenCalledWith('example.com');
  });

  it('rejeita um hostname que resolve (DNS rebinding) para um endereço privado', async () => {
    const resolveHostname = vi.fn().mockResolvedValue(['10.0.0.5']);
    await expect(
      assertSafeWebhookUrl('https://internal.attacker.example/x', resolveHostname),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('rejeita se qualquer um dos endereços resolvidos for privado (multi-A/AAAA)', async () => {
    const resolveHostname = vi.fn().mockResolvedValue(['8.8.8.8', '169.254.169.254']);
    await expect(
      assertSafeWebhookUrl('https://multi-homed.example/x', resolveHostname),
    ).rejects.toThrow(SsrfBlockedError);
  });

  it('rejeita hostname que não resolve a nenhum endereço', async () => {
    const resolveHostname = vi.fn().mockResolvedValue([]);
    await expect(assertSafeWebhookUrl('https://nowhere.example/x', resolveHostname)).rejects.toThrow(
      SsrfBlockedError,
    );
  });

  it('propaga falha de resolução DNS como SsrfBlockedError', async () => {
    const resolveHostname = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertSafeWebhookUrl('https://nao-existe.example/x', resolveHostname)).rejects.toThrow(
      SsrfBlockedError,
    );
  });
});

describe('safeWebhookFetch (fetch com validação a cada redirecionamento)', () => {
  it('requisita normalmente um alvo público sem redirecionamento', async () => {
    const resolveHostname = vi.fn().mockResolvedValue(['93.184.216.34']);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const response = await safeWebhookFetch(
      'https://example.com/hooks/cube-track',
      { method: 'POST' },
      { fetchImpl, resolveHostname },
    );
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });

  it('segue um redirecionamento para outro alvo público e revalida antes de seguir', async () => {
    const resolveHostname = vi.fn().mockResolvedValue(['93.184.216.34']);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://example.com/next' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const response = await safeWebhookFetch(
      'https://example.com/hooks/cube-track',
      { method: 'POST' },
      { fetchImpl, resolveHostname },
    );
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://example.com/next');
  });

  it('rejeita quando o redirecionamento aponta para um endereço privado', async () => {
    const resolveHostname = vi.fn().mockImplementation((hostname: string) =>
      Promise.resolve(hostname === 'internal.example' ? ['10.0.0.7'] : ['93.184.216.34']),
    );
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://internal.example/secret' } }),
    );
    await expect(
      safeWebhookFetch(
        'https://example.com/hooks/cube-track',
        { method: 'POST' },
        { fetchImpl, resolveHostname },
      ),
    ).rejects.toThrow(SsrfBlockedError);
    // Só a primeira requisição (para o alvo original, válido) deve ter sido feita.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejeita o alvo original antes mesmo de chamar fetch', async () => {
    const resolveHostname = vi.fn().mockResolvedValue(['127.0.0.1']);
    const fetchImpl = vi.fn();
    await expect(
      safeWebhookFetch(
        'https://loopback-via-dns.example/x',
        { method: 'POST' },
        { fetchImpl, resolveHostname },
      ),
    ).rejects.toThrow(SsrfBlockedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
