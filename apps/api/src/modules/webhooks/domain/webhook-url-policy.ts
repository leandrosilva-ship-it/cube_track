import { BlockList, isIP } from 'node:net';

/**
 * Checagem de SSRF (OWASP A10) no cadastro/edição de um webhook de saída (ADR 0051): regra pura,
 * sem Nest nem Drizzle. Rejeita, só com base no texto da URL (sem DNS), esquemas diferentes de
 * http(s), `localhost` e literais de IP privado/loopback/link-local/reservado.
 *
 * **Isto não é suficiente sozinho**: um hostname público e válido aqui pode resolver para um
 * endereço privado no momento da entrega (DNS rebinding — a resolução muda entre o cadastro e
 * cada tentativa de entrega). Por isso o worker revalida via DNS a cada tentativa, inclusive a
 * cada redirecionamento, imediatamente antes de requisitar — ver
 * `apps/worker/src/processors/webhook-url-guard.ts`.
 */

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

const disallowedIpv6 = new BlockList();
disallowedIpv6.addAddress('::1', 'ipv6'); // loopback
disallowedIpv6.addSubnet('fe80::', 10, 'ipv6'); // link-local
disallowedIpv6.addSubnet('fc00::', 7, 'ipv6'); // unique local (equivalente a RFC 1918)
disallowedIpv6.addAddress('::', 'ipv6'); // não especificado

// `new URL(...)` normaliza IPv4-mapped-IPv6 para hextetos hex (`::ffff:192.168.1.1` vira
// `::ffff:c0a8:101`), então aceitamos as duas formas: decimal pontuada e hex.
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

function isDisallowedIpLiteral(address: string): boolean {
  const mapped = extractIpv4Mapped(address);
  if (mapped !== null) return disallowedIpv4.check(mapped, 'ipv4');
  const family = isIP(address);
  if (family === 4) return disallowedIpv4.check(address, 'ipv4');
  if (family === 6) return disallowedIpv6.check(address, 'ipv6');
  return false;
}

export interface WebhookUrlCheck {
  allowed: boolean;
  reason?: string;
}

/** Normaliza o hostname de `URL.hostname` (IPv6 literal vem entre colchetes: `[::1]`). */
function normalizeHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Checagem pura e síncrona (sem DNS) — usada pelo schema Zod de criação/edição e pelo serviço de
 * webhooks como segunda linha de defesa.
 */
export function checkWebhookUrl(rawUrl: string): WebhookUrlCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'URL inválida.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `Esquema não permitido: ${url.protocol}` };
  }
  const hostname = normalizeHostname(url.hostname).toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return { allowed: false, reason: 'Hostname não permitido: localhost.' };
  }
  if (isIP(hostname) !== 0 && isDisallowedIpLiteral(hostname)) {
    return { allowed: false, reason: `Endereço IP não permitido: ${hostname}.` };
  }
  return { allowed: true };
}

export function isAllowedWebhookUrl(rawUrl: string): boolean {
  return checkWebhookUrl(rawUrl).allowed;
}
