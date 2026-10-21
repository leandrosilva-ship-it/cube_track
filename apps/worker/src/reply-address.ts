import { createHmac } from 'node:crypto';

import { encodeReplyPayload, type ReplyTokenPayload } from '@cube-track/shared';

/**
 * Gera o mesmo endereço `reply+<payload>.<assinatura>@<domínio>` que a API confere no webhook de
 * e-mail recebido (ADR 0048) — a codificação do payload vem de `@cube-track/shared`; só a
 * assinatura HMAC (com o mesmo `JWT_SECRET` da API, domínio próprio `email-reply:`) é local a cada
 * processo, pois usa `node:crypto`.
 */
export function buildReplyAddress(
  jwtSecret: string,
  mailReplyDomain: string,
  payload: ReplyTokenPayload,
): string {
  const { data, encoded } = encodeReplyPayload(payload);
  const signature = createHmac('sha256', jwtSecret)
    .update(`email-reply:${data}`)
    .digest('hex')
    .slice(0, 16);
  return `reply+${encoded}.${signature}@${mailReplyDomain}`;
}
