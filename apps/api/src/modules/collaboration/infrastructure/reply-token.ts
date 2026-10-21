import { Inject, Injectable } from '@nestjs/common';
import {
  decodeReplyPayload,
  encodeReplyPayload,
  REPLY_ADDRESS_RE,
  type ReplyTokenPayload,
} from '@cube-track/shared';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { hmacHex, safeEqualHex } from '../../../core/crypto/secrets.js';

export type { ReplyTokenPayload } from '@cube-track/shared';

/**
 * Endereço de resposta por e-mail de um item (ADR 0048): `reply+<payload base64url>.<assinatura>@
 * <domínio>`. Sem estado no banco — a assinatura HMAC (derivada de `JWT_SECRET`, com domínio
 * próprio `email-reply:`) garante que só endereços emitidos por nós sejam aceitos no webhook de
 * entrada, sem precisar persistir ou expirar tokens. A codificação do payload é compartilhada com
 * o worker (`@cube-track/shared`); só a assinatura usa `node:crypto` e fica em cada processo.
 */
@Injectable()
export class ReplyTokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  address(payload: ReplyTokenPayload): string {
    const { data, encoded } = encodeReplyPayload(payload);
    const signature = hmacHex(this.config.JWT_SECRET, `email-reply:${data}`, 16);
    return `reply+${encoded}.${signature}@${this.config.MAIL_REPLY_DOMAIN}`;
  }

  parse(address: string): ReplyTokenPayload | null {
    const match = REPLY_ADDRESS_RE.exec(address.trim());
    if (match === null) return null;
    const [, encoded, signature] = match;
    if (encoded === undefined || signature === undefined) return null;
    const decoded = decodeReplyPayload(encoded);
    if (decoded === null) return null;
    const expected = hmacHex(this.config.JWT_SECRET, `email-reply:${decoded.data}`, 16);
    if (!safeEqualHex(signature, expected)) return null;
    return decoded.payload;
  }
}
