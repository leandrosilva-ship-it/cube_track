import { z } from 'zod';

/** Paginação por cursor (keyset). O cursor é opaco para o cliente (base64url de JSON). */

export type CursorValue = string | number | boolean | null;

export interface Cursor {
  /** Valores das chaves de ordenação do último registro da página, na ordem do `sort`. */
  keys: CursorValue[];
  /** Desempate final (id). */
  id: string;
  /** Assinatura da ordenação usada, para rejeitar cursores de outra consulta. */
  sort: string;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(JSON.stringify([cursor.sort, cursor.keys, cursor.id]));
}

const decodedSchema = z.tuple([
  z.string(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  z.string(),
]);

/** Decodifica um cursor; retorna null se for inválido ou de outra ordenação. */
export function decodeCursor(raw: string, expectedSort: string): Cursor | null {
  try {
    const parsed = decodedSchema.safeParse(JSON.parse(fromBase64Url(raw)));
    if (!parsed.success) return null;
    const [sort, keys, id] = parsed.data;
    if (sort !== expectedSort) return null;
    return { sort, keys, id };
  } catch {
    return null;
  }
}

export const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().max(2_000).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export interface Page<T> {
  data: T[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}
