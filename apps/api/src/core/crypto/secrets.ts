import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token aleatório de alta entropia (URL-safe) para links, sessões de link público e afins. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash SHA-256 (hex) — tokens nunca são armazenados em claro. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** HMAC-SHA256 (hex, truncado a `length` caracteres) — tokens assinados sem estado (ex.: resposta por e-mail). */
export function hmacHex(secret: string, value: string, length = 32): string {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, length);
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Comparação em tempo constante de dois segredos em texto simples (ex.: cabeçalho de webhook). */
export function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
