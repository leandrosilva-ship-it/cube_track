import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Geração/hash de token são utilitários genéricos (sem estado de identidade): vivem no núcleo
// compartilhado (`core/crypto`) para que outros módulos (ex.: links públicos de view) os reusem
// sem depender da camada de domínio deste módulo.
export { randomToken, safeEqualHex, sha256Hex } from '../../../core/crypto/secrets.js';

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
