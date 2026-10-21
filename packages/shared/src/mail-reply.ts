/**
 * Formato do endereço de resposta por e-mail de um item (ADR 0048): `reply+<payload>.<assinatura>@
 * <domínio>`. Este módulo só cuida da codificação/decodificação do payload (puro, roda no
 * navegador); a assinatura HMAC usa `node:crypto` e fica no backend (API grava, worker confirma).
 */
export interface ReplyTokenPayload {
  itemId: string;
  userId: string;
  /** Resposta a uma atualização específica (ex.: notificação de menção); null = atualização nova. */
  updateId: string | null;
}

export const REPLY_ADDRESS_RE = /^reply\+([A-Za-z0-9_-]+)\.([0-9a-f]+)@/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

/** Dados a assinar (`data`) e sua forma codificada para o endereço (`encoded`). */
export function encodeReplyPayload(payload: ReplyTokenPayload): { data: string; encoded: string } {
  const data = `${payload.itemId}:${payload.userId}:${payload.updateId ?? ''}`;
  return { data, encoded: toBase64Url(data) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decodifica sem verificar a assinatura — o chamador deve conferir o HMAC antes de confiar. */
export function decodeReplyPayload(encoded: string): { data: string; payload: ReplyTokenPayload } | null {
  const data = fromBase64Url(encoded);
  if (data === null) return null;
  const [itemId, userId, updateId] = data.split(':');
  if (itemId === undefined || userId === undefined || !UUID_RE.test(itemId) || !UUID_RE.test(userId)) {
    return null;
  }
  return { data, payload: { itemId, userId, updateId: updateId === undefined || updateId === '' ? null : updateId } };
}
