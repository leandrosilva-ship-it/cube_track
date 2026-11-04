import type { ApiScope } from '@cube-track/shared/api-access';
import { sql } from 'drizzle-orm';
import { boolean, check, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { tenantTable } from './_helpers.js';

/**
 * App OAuth (Prompt 15, ADR 0056): entidade que só serve para emitir tokens via
 * `POST /v1/oauth/token` (`grant_type=client_credentials`) — o token emitido é uma linha comum de
 * `api_tokens` (`identity.ts`, já reservada desde o início do projeto) com `oauthAppId` preenchido em
 * vez de `userId`.
 */
export const oauthApps = tenantTable(
  'oauth_apps',
  {
    name: text('name').notNull(),
    description: text('description'),
    clientId: text('client_id').notNull(),
    /** Cifrado (AES-256-GCM, `@cube-track/shared/crypto`) — nunca exposto em texto puro depois de criado. */
    clientSecretCiphertext: text('client_secret_ciphertext').notNull(),
    scopes: text('scopes').array().$type<ApiScope[]>().notNull().default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('oauth_apps_client_id_key').on(t.clientId),
    check('oauth_apps_name_len', sql`char_length(${t.name}) between 1 and 120`),
  ],
);
