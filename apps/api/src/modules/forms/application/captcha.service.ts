import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../../core/config/config.js';
import { hmacHex, safeEqualHex } from '../../../core/crypto/secrets.js';

const TTL_MS = 10 * 60 * 1000;

interface ChallengePayload {
  a: number;
  b: number;
  issuedAt: number;
}

export interface Challenge {
  /** Opaco: `<payload base64url>.<assinatura>` — devolvido pelo cliente junto da resposta. */
  token: string;
  /** Pergunta em texto (ex.: "Quanto é 3 + 5?"), para exibir no formulário. */
  question: string;
}

function encode(payload: ChallengePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decode(data: string): ChallengePayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as ChallengePayload).a === 'number' &&
      typeof (parsed as ChallengePayload).b === 'number' &&
      typeof (parsed as ChallengePayload).issuedAt === 'number'
    ) {
      return parsed as ChallengePayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Captcha auto-emitido (sem integração de terceiros): desafio de soma assinado por HMAC, sem
 * estado no banco — a assinatura garante que só desafios emitidos por nós sejam aceitos, e o
 * `issuedAt` embutido limita a validade a 10 minutos. Usado junto com um campo-isca (honeypot) nos
 * envios públicos de formulário sem login.
 */
@Injectable()
export class CaptchaService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  issue(): Challenge {
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const data = encode({ a, b, issuedAt: Date.now() });
    const signature = hmacHex(this.config.JWT_SECRET, `form-captcha:${data}`, 16);
    return { token: `${data}.${signature}`, question: `Quanto é ${a} + ${b}?` };
  }

  verify(token: string, answer: number): boolean {
    const [data, signature] = token.split('.');
    if (data === undefined || signature === undefined) return false;
    const expected = hmacHex(this.config.JWT_SECRET, `form-captcha:${data}`, 16);
    if (!safeEqualHex(signature, expected)) return false;
    const payload = decode(data);
    if (payload === null) return false;
    if (Date.now() - payload.issuedAt > TTL_MS) return false;
    return payload.a + payload.b === answer;
  }
}
