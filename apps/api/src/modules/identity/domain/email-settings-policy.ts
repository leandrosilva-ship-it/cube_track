import { isIP } from 'node:net';

/**
 * Checagem pura (sem DNS) do host de SMTP configurado por um tenant (ADR a confirmar) — mesmo
 * espírito do `checkWebhookUrl` (ADR 0051/0057): rejeita, só com base no texto, `localhost` e
 * literais de IP privado/loopback/link-local, para um admin de tenant não conseguir apontar o
 * worker da plataforma para um serviço interno via SMTP.
 *
 * Mais fraco que o SSRF de webhooks por natureza do protocolo (SMTP não devolve corpo de resposta
 * HTTP ao tenant), mas ainda evita que a configuração vire uma sonda de conectividade para a rede
 * interna. Sem revalidação por DNS a cada envio (diferente do webhook-url-guard) — risco aceito:
 * mudar a configuração exige a mesma permissão (`email.manage`) usada para o resto da função.
 */

function isPrivateIpv4(host: string): boolean {
  if (host.startsWith('10.') || host.startsWith('127.') || host.startsWith('169.254.')) return true;
  if (host.startsWith('192.168.')) return true;
  const match = /^172\.(\d{1,3})\./.exec(host);
  if (match?.[1] === undefined) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}

function isPrivateIpv6(host: string): boolean {
  return host === '::1' || host === '::' || /^fe80:/i.test(host) || /^fc00:/i.test(host) || /^fd/i.test(host);
}

export interface EmailHostCheck {
  allowed: boolean;
  reason?: string;
}

export function checkEmailHost(rawHost: string): EmailHostCheck {
  const host = rawHost.trim().toLowerCase();
  if (host === '') return { allowed: false, reason: 'Host obrigatório.' };
  if (host === 'localhost' || host.endsWith('.localhost'))
    return { allowed: false, reason: 'Host não permitido: localhost.' };
  const family = isIP(host);
  if (family === 4 && isPrivateIpv4(host))
    return { allowed: false, reason: `Endereço IP não permitido: ${host}.` };
  if (family === 6 && isPrivateIpv6(host))
    return { allowed: false, reason: `Endereço IP não permitido: ${host}.` };
  return { allowed: true };
}

export function isAllowedEmailHost(rawHost: string): boolean {
  return checkEmailHost(rawHost).allowed;
}
