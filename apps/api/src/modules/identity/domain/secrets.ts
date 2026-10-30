import { randomBytes } from 'node:crypto';

// Geração/hash de token são utilitários genéricos (sem estado de identidade): vivem no núcleo
// compartilhado (`core/crypto`) para que outros módulos (ex.: links públicos de view) os reusem
// sem depender da camada de domínio deste módulo.
export { randomToken, safeEqualHex, sha256Hex } from '../../../core/crypto/secrets.js';

// Cifra de segredos em repouso: vive em `@cube-track/shared` (ADR 0051) para que o worker também a
// use (decifrar o segredo de um webhook para assinar a entrega) sem depender desta API.
export { decryptSecret, encryptSecret } from '@cube-track/shared/crypto';

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
