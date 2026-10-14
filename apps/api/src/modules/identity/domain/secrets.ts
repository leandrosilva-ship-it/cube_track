import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Token aleatório de alta entropia (URL-safe) para links e refresh tokens. */
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

/** Cifra AES-256-GCM: `v1:iv:tag:ciphertext` (base64url). */
export function encryptSecret(plaintext: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(payload: string, keyBase64: string): string {
  const [version, iv, tag, ciphertext] = payload.split(':');
  if (version !== 'v1' || iv === undefined || tag === undefined || ciphertext === undefined)
    throw new Error('Segredo cifrado inválido');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(keyBase64, 'base64'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Códigos de recuperação de MFA (`xxxx-xxxx`, base32 sem ambiguidade). */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s/g, '');
}
