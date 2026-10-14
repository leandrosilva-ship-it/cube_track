import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** TOTP (RFC 6238) com HMAC-SHA1, passo de 30 s e 6 dígitos — compatível com apps autenticadores. */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buffer: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) para um contador. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function generateTotp(secretBase32: string, timeMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpStep(timeMs));
}

/**
 * Verifica um código TOTP aceitando ±`window` passos (tolerância de relógio).
 * Retorna o passo que validou (para impedir reutilização) ou null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  timeMs = Date.now(),
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(timeMs);
  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = hotp(secret, current + delta);
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) return current + delta;
  }
  return null;
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'CUBE TRACK'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
