/**
 * Destino pós-login vindo de `?next=`: aceita só caminhos internos (evita open redirect para
 * `//evil.com`, `https://…` ou `/\evil`).
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/\p{Cc}/u.test(raw)) return fallback;
  return raw;
}
