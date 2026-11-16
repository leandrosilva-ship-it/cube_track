import { boolean, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { tenantTable } from './_helpers.js';
import { users } from './identity.js';

/**
 * Configuração de e-mail (SMTP) do TENANT — não por workspace, igual a `ai_settings`: cada
 * organização pode usar seu próprio provedor de envio, substituindo o SMTP padrão da plataforma
 * (variável de ambiente `SMTP_URL`). Sem linha, ou com `enabled: false`, o worker usa o padrão da
 * plataforma — nunca falha por falta de configuração do tenant. Campos separados (não uma única
 * string de conexão) para a tela de configurações preencher um formulário de verdade; só a senha é
 * sensível e cifrada — host/porta/usuário/remetente voltam em texto puro na leitura.
 */
export const emailSettings = tenantTable(
  'email_settings',
  {
    host: text('host'),
    port: integer('port'),
    /** `true` = TLS implícito (smtps, porta usual 465); `false` = STARTTLS (smtp, porta usual 587). */
    secure: boolean('secure').notNull().default(true),
    username: text('username'),
    /** Cifrada (AES-256-GCM, `@cube-track/shared/crypto`) — nunca exposta em texto puro pela API. */
    passwordCiphertext: text('password_ciphertext'),
    fromAddress: text('from_address'),
    enabled: boolean('enabled').notNull().default(false),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('email_settings_tenant_key').on(t.tenantId)],
);
