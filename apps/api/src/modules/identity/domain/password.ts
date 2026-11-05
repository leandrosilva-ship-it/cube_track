// Hash/verificação de senha são utilitários genéricos (sem estado de identidade): vivem no núcleo
// compartilhado (`core/crypto`) para que outros módulos (ex.: senha de link público de view) os
// reusem sem depender da camada de domínio deste módulo.
import { verifyPassword } from '../../../core/crypto/password.js';

export { hashPassword, verifyPassword } from '../../../core/crypto/password.js';

import { checkPasswordPolicy as checkConfiguredPasswordPolicy, type PasswordPolicy } from '@cube-track/shared';

export interface PasswordPolicyResult {
  ok: boolean;
  reasons: string[];
}

const VIOLATION_MESSAGES: Record<string, string> = {
  min_length: 'A senha não atende ao tamanho mínimo exigido pela organização.',
  uppercase: 'A senha precisa de ao menos uma letra maiúscula.',
  lowercase: 'A senha precisa de ao menos uma letra minúscula.',
  digit: 'A senha precisa de ao menos um número.',
  symbol: 'A senha precisa de ao menos um símbolo.',
};

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'senha123',
  'qwertyuiop',
  'cubetrack',
]);

/**
 * Política de senha: regras de base (sempre aplicadas, não configuráveis — tamanho/complexidade
 * mínima, bloqueio de senhas comuns, proibição de conter o e-mail) MAIS, quando `tenantPolicy` é
 * informado, a política configurável do tenant (ADR 0057, `@cube-track/shared/security`: tamanho
 * mínimo maior, maiúscula/minúscula/número/símbolo obrigatórios). As duas sempre se somam — a
 * configurável nunca AFROUXA a de base.
 */
export function checkPasswordPolicy(
  password: string,
  email?: string,
  tenantPolicy?: PasswordPolicy,
): PasswordPolicyResult {
  const reasons: string[] = [];
  if (password.length < 10) reasons.push('A senha deve ter pelo menos 10 caracteres.');
  if (password.length > 128) reasons.push('A senha deve ter no máximo 128 caracteres.');
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) reasons.push('Use letras e números.');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) reasons.push('Senha muito comum.');
  const local = email?.split('@')[0]?.toLowerCase();
  if (local !== undefined && local.length >= 4 && password.toLowerCase().includes(local)) {
    reasons.push('A senha não pode conter seu e-mail.');
  }
  if (tenantPolicy !== undefined) {
    for (const violation of checkConfiguredPasswordPolicy(password, tenantPolicy)) {
      const message = VIOLATION_MESSAGES[violation] ?? 'A senha não atende à política da organização.';
      if (!reasons.includes(message)) reasons.push(message);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** A senha bate com alguma das anteriores (histórico, `historyCount`). Hashes vêm mais recentes
 * primeiro; comparação é feita com Argon2id (`verifyPassword`), nunca por igualdade de hash. */
export async function isPasswordReused(
  password: string,
  previousHashes: readonly string[],
): Promise<boolean> {
  for (const hash of previousHashes) {
    if (await verifyPassword(hash, password)) return true;
  }
  return false;
}
