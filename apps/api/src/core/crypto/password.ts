import { hash, verify } from '@node-rs/argon2';

/** Argon2id com parâmetros recomendados pela OWASP (m=19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

/** Hash fictício (gerado uma vez) para equalizar o tempo de resposta quando o segredo não existe. */
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
