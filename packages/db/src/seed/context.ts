import type { Transaction } from '../client.js';
import type { SeededRandom } from './random.js';

/** Data de referência do seed (o "hoje" dos dados de demonstração). */
export const SEED_REFERENCE_DATE = '2026-10-14';

/** IDs fixos do tenant de demonstração, para que o seed seja idempotente e fácil de referenciar. */
export const DEMO_TENANT_ID = '01920000-0000-7000-8000-000000000001';
export const DEMO_TENANT_SLUG = 'empresa-demo';

/** Tokens públicos de demonstração (no banco ficam apenas os hashes SHA-256). */
export const DEMO_SHARE_TOKEN = 'demo-pmsp-share-token';
export const DEMO_FORM_TOKEN = 'demo-pmsp-form-token';

export interface SeedContext {
  tx: Transaction;
  tenantId: string;
  rng: SeededRandom;
  users: Record<string, string>;
  roleIds: Record<string, string>;
  calendarId: string;
  workspaceId: string;
  folderIds: Record<string, string>;
  teamIds: Record<string, string>;
}

export function userId(ctx: SeedContext, key: string): string {
  const id = ctx.users[key];
  if (id === undefined) throw new Error(`Usuário de seed desconhecido: ${key}`);
  return id;
}

export function folderId(ctx: SeedContext, name: string): string {
  const id = ctx.folderIds[name];
  if (id === undefined) throw new Error(`Pasta de seed desconhecida: ${name}`);
  return id;
}

export function roleId(ctx: SeedContext, key: string): string {
  const id = ctx.roleIds[key];
  if (id === undefined) throw new Error(`Papel desconhecido: ${key}`);
  return id;
}

/** Documento Tiptap mínimo com menções e texto. */
export function richText(
  parts: ({ text: string } | { mention: { id: string; label: string } })[],
): {
  doc: Record<string, unknown>;
  text: string;
} {
  const content = parts.map((part) =>
    'text' in part
      ? { type: 'text', text: part.text }
      : { type: 'mention', attrs: { id: part.mention.id, label: part.mention.label } },
  );
  const text = parts
    .map((part) => ('text' in part ? part.text : `@${part.mention.label}`))
    .join('');
  return { doc: { type: 'doc', content: [{ type: 'paragraph', content }] }, text };
}
