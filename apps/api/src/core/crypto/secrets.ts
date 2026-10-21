import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token aleatório de alta entropia (URL-safe) para links, sessões de link público e afins. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash SHA-256 (hex) — tokens nunca são armazenados em claro. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
