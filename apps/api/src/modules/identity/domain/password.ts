// Hash/verificação de senha são utilitários genéricos (sem estado de identidade): vivem no núcleo
// compartilhado (`core/crypto`) para que outros módulos (ex.: senha de link público de view) os
// reusem sem depender da camada de domínio deste módulo.
export { hashPassword, verifyPassword } from '../../../core/crypto/password.js';

export interface PasswordPolicyResult {
  ok: boolean;
  reasons: string[];
}

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'senha123',
  'qwertyuiop',
  'cubetrack',
]);

/** Política de senha: ≥ 10 caracteres, letras e números, sem conter o e-mail, fora de listas comuns. */
export function checkPasswordPolicy(password: string, email?: string): PasswordPolicyResult {
  const reasons: string[] = [];
  if (password.length < 10) reasons.push('A senha deve ter pelo menos 10 caracteres.');
  if (password.length > 128) reasons.push('A senha deve ter no máximo 128 caracteres.');
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) reasons.push('Use letras e números.');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) reasons.push('Senha muito comum.');
  const local = email?.split('@')[0]?.toLowerCase();
  if (local !== undefined && local.length >= 4 && password.toLowerCase().includes(local)) {
    reasons.push('A senha não pode conter seu e-mail.');
  }
  return { ok: reasons.length === 0, reasons };
}
