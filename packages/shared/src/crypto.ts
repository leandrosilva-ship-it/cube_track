import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra de segredos em repouso (ADR 0026/0051): AES-256-GCM, `v1:iv:tag:ciphertext` (base64url).
 * Usada pela API (MFA, segredo de webhook) e pelo worker (entrega de webhook) com a mesma chave
 * (`ENCRYPTION_KEY`), para que um decifre o que o outro cifrou.
 */
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
