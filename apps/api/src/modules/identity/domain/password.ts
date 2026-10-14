import { hash, verify } from '@node-rs/argon2';

/** Argon2id com parâmetros recomendados pela OWASP (m=19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

/** Hash fictício (gerado uma vez) para equalizar o tempo de resposta quando o usuário não existe. */
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Verifica a senha; com `passwordHash` nulo executa uma verificação fictícia (anti enumeração). */
export async function verifyPassword(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  try {
    dummyHash ??= hash('cube-track-dummy-password', ARGON2_OPTIONS);
    const ok = await verify(passwordHash ?? (await dummyHash), password);
    return passwordHash !== null && ok;
  } catch {
    return false;
  }
}

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
