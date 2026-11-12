import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/**
 * Guarda contra SSRF (OWASP A10) na entrega de webhooks de saída (ADR 0051).
 *
 * Um tenant malicioso ou comprometido pode cadastrar (ou, via DNS rebinding, fazer resolver em
 * tempo de entrega) uma URL de webhook que aponta para endereços internos — ex.: o endpoint de
 * metadados de nuvem (`169.254.169.254`), `localhost` ou uma faixa RFC 1918 — fazendo o worker
 * da plataforma requisitar, em nome dela, recursos que nunca deveriam ser expostos a um tenant.
 *
 * Duas camadas:
 * 1. {@link assertAllowedWebhookUrlLiteral} — checagem síncrona e barata (esquema, host literal)
 *    usada na API no momento do cadastro/edição (ver `apps/api/src/modules/webhooks`).
 * 2. {@link safeWebhookFetch} — checagem em tempo de entrega, no worker: resolve o hostname via
 *    DNS e valida **cada** endereço resolvido contra as faixas privadas/reservadas abaixo, e repete
 *    a validação a cada redirecionamento (seguidos manualmente, nunca automaticamente pelo
 *    `fetch`) para fechar o vetor de DNS rebinding / redirect para endereço interno.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

const MAX_REDIRECTS = 5;

/** Faixas privadas/reservadas (RFC 1918, loopback, link-local e correlatas) — IPv4. */
const disallowedIpv4 = new BlockList();
disallowedIpv4.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC 1918
disallowedIpv4.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC 1918
disallowedIpv4.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC 1918
disallowedIpv4.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
disallowedIpv4.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local (inclui metadados de nuvem)
disallowedIpv4.addSubnet('0.0.0.0', 8, 'ipv4'); // "esta" rede
disallowedIpv4.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT
disallowedIpv4.addSubnet('192.0.0.0', 24, 'ipv4'); // atribuições de protocolo IETF
disallowedIpv4.addSubnet('192.0.2.0', 24, 'ipv4'); // TEST-NET-1 (documentação)
disallowedIpv4.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmark
disallowedIpv4.addSubnet('198.51.100.0', 24, 'ipv4'); // TEST-NET-2 (documentação)
disallowedIpv4.addSubnet('203.0.113.0', 24, 'ipv4'); // TEST-NET-3 (documentação)
disallowedIpv4.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
disallowedIpv4.addSubnet('240.0.0.0', 4, 'ipv4'); // reservado
disallowedIpv4.addAddress('255.255.255.255', 'ipv4'); // broadcast

/** Faixas privadas/reservadas — IPv6. */
const disallowedIpv6 = new BlockList();
disallowedIpv6.addAddress('::1', 'ipv6'); // loopback
disallowedIpv6.addSubnet('fe80::', 10, 'ipv6'); // link-local
disallowedIpv6.addSubnet('fc00::', 7, 'ipv6'); // unique local (equivalente a RFC 1918)
disallowedIpv6.addAddress('::', 'ipv6'); // não especificado

// `new URL(...)` normaliza IPv4-mapped-IPv6 para hextetos hex (`::ffff:192.168.1.1` vira
// `::ffff:c0a8:101`); `dns.lookup` com `verbatim: true` devolve a forma decimal pontuada.
// Aceitamos as duas.
const IPV4_MAPPED_DOTTED = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;
const IPV4_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

/** Extrai o IPv4 embutido de um literal IPv4-mapped-IPv6, em qualquer forma, ou `null`. */
function extractIpv4Mapped(address: string): string | null {
  const dotted = IPV4_MAPPED_DOTTED.exec(address);
  if (dotted?.[1] !== undefined) return dotted[1];
  const hex = IPV4_MAPPED_HEX.exec(address);
  if (hex?.[1] !== undefined && hex[2] !== undefined) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  }
  return null;
}

/** Verifica um endereço IP já resolvido (sem fazer DNS) contra as faixas privadas/reservadas. */
export function isDisallowedIpAddress(address: string): boolean {
  const mapped = extractIpv4Mapped(address);
  if (mapped !== null) return disallowedIpv4.check(mapped, 'ipv4');

  const family = isIP(address);
  if (family === 4) return disallowedIpv4.check(address, 'ipv4');
  if (family === 6) return disallowedIpv6.check(address, 'ipv6');
  // Não é um literal de IP válido (ex.: hostname ainda não resolvido) — nada a bloquear aqui.
  return false;
}

/** Esquemas e hosts banidos sem precisar de DNS — usado também na checagem literal da API. */
function assertAllowedScheme(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Esquema não permitido: ${url.protocol}`);
  }
}

function normalizeHostname(hostname: string): string {
  // new URL() envolve IPv6 literais em colchetes, ex. "[::1]".
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

/**
 * Checagem síncrona e barata (sem DNS), usada no cadastro/edição do webhook (API): rejeita
 * esquemas diferentes de http(s), `localhost` e literais de IP privado/loopback/link-local na
 * própria URL. **Não é suficiente sozinha** — um hostname público pode resolver para um endereço
 * privado em tempo de entrega (DNS rebinding), por isso a entrega real revalida via
 * {@link safeWebhookFetch}.
 */
export function assertAllowedWebhookUrlLiteral(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('URL inválida.');
  }
  assertAllowedScheme(url);
  const hostname = normalizeHostname(url.hostname).toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new SsrfBlockedError('Hostname não permitido: localhost.');
  }
  if (isIP(hostname) !== 0 && isDisallowedIpAddress(hostname)) {
    throw new SsrfBlockedError(`Endereço IP não permitido: ${hostname}.`);
  }
}

export type HostnameResolver = (hostname: string) => Promise<string[]>;

/** Resolvedor padrão: `dns.promises.lookup` pedindo todos os endereços (A e AAAA). */
export const defaultResolveHostname: HostnameResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
};

/**
 * Valida um host (literal de IP ou nome resolvido via DNS) em tempo de entrega. Lança
 * {@link SsrfBlockedError} se o literal for privado/reservado, ou se **qualquer** endereço
 * resolvido for.
 */
async function assertSafeHost(hostname: string, resolveHostname: HostnameResolver): Promise<void> {
  const normalized = normalizeHostname(hostname);
  if (normalized.toLowerCase() === 'localhost' || normalized.toLowerCase().endsWith('.localhost')) {
    throw new SsrfBlockedError('Hostname não permitido: localhost.');
  }
  if (isIP(normalized) !== 0) {
    if (isDisallowedIpAddress(normalized)) {
      throw new SsrfBlockedError(`Endereço IP não permitido: ${normalized}.`);
    }
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolveHostname(normalized);
  } catch (error) {
    throw new SsrfBlockedError(
      `Falha ao resolver host "${normalized}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`Host "${normalized}" não resolveu a nenhum endereço.`);
  }
  const blocked = addresses.find((address) => isDisallowedIpAddress(address));
  if (blocked !== undefined) {
    throw new SsrfBlockedError(
      `Host "${normalized}" resolve para endereço privado/reservado não permitido: ${blocked}.`,
    );
  }
}

/** Valida esquema + host (com resolução DNS) de uma URL completa antes de requisitá-la. */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  resolveHostname: HostnameResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('URL inválida.');
  }
  assertAllowedScheme(url);
  await assertSafeHost(url.hostname, resolveHostname);
  return url;
}

/**
 * `fetch` com proteção SSRF em tempo de entrega: valida esquema + endereços DNS da URL antes de
 * requisitar e, como o `fetch` nativo segue redirecionamentos automaticamente (abrindo uma rota
 * para um host malicioso redirecionar para um endereço interno), desabilita o redirecionamento
 * automático (`redirect: 'manual'`) e segue cada salto manualmente, revalidando esquema + DNS a
 * cada hop, até {@link MAX_REDIRECTS} redirecionamentos.
 */
export async function safeWebhookFetch(
  rawUrl: string,
  init: RequestInit,
  deps: { fetchImpl: typeof fetch; resolveHostname: HostnameResolver },
): Promise<Response> {
  let currentUrl = await assertSafeWebhookUrl(rawUrl, deps.resolveHostname);
  for (let redirects = 0; ; redirects += 1) {
    const response = await deps.fetchImpl(currentUrl.toString(), { ...init, redirect: 'manual' });
    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get('location');
    if (!isRedirect || location === null) return response;
    if (redirects >= MAX_REDIRECTS) {
      throw new SsrfBlockedError(`Número máximo de redirecionamentos excedido (${MAX_REDIRECTS}).`);
    }
    const nextUrl = new URL(location, currentUrl);
    currentUrl = await assertSafeWebhookUrl(nextUrl.toString(), deps.resolveHostname);
  }
}
