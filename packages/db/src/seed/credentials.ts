import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';

import type { Database } from '../client.js';
import { DEMO_USERS } from './data.js';

/** Senha dos usuários de demonstração (somente ambientes locais/homologação). */
export const DEMO_PASSWORD = 'CubeTrack@2026';

/**
 * Define a senha dos usuários de demonstração. Executado com o papel dono do schema (o papel da
 * aplicação não altera usuários de terceiros), mesmos parâmetros Argon2id da API.
 */
export async function seedDemoCredentials(db: Database): Promise<void> {
  const passwordHash = await hash(DEMO_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
  const emails = DEMO_USERS.map((user) => user.email.toLowerCase());
  await db.execute(sql`
    update users
       set password_hash = ${passwordHash}, password_changed_at = now(), email_verified_at = coalesce(email_verified_at, now())
     where lower(email) in (${sql.join(
       emails.map((email) => sql`${email}`),
       sql`, `,
     )})
       and password_hash is null`);
}
