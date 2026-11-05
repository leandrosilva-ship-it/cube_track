/**
 * Verificação de assinatura de webhook do Stripe (Prompt 16, ADR 0059). Usa `node:crypto`: de
 * propósito FORA do barrel principal (`index.ts`), mesmo motivo de `crypto.ts`/`integrations.ts` —
 * importar de `@cube-track/shared/billing-webhook`, nunca de `@cube-track/shared`, ou o webpack do
 * `apps/web` volta a quebrar o bundle do cliente (ver `0483796a`, correção equivalente para
 * `integrations.ts`).
 *
 * Esquema real do Stripe: cabeçalho `Stripe-Signature: t=<timestamp>,v1=<hex hmac>[,v1=...]`
 * (pode haver mais de um `v1`, ex. durante rotação de segredo — basta UM bater), HMAC-SHA256 de
 * `"${t}.${rawBody}"` com o signing secret do endpoint. Rejeita timestamps com mais de 5 minutos
 * (proteção contra repetição).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_SECONDS = 300;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseSignatureHeader(header: string): { timestamp: string | null; v1: string[] } {
  const v1: string[] = [];
  let timestamp: string | null = null;
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === undefined || value === undefined) continue;
    if (key.trim() === 't') timestamp = value.trim();
    else if (key.trim() === 'v1') v1.push(value.trim());
  }
  return { timestamp, v1 };
}

/**
 * Verifica `Stripe-Signature` contra o segredo do endpoint de webhook. `now` (ms epoch) é
 * injetável para teste; por padrão usa o relógio real.
 */
export function verifyStripeSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
  now: number = Date.now(),
): boolean {
  if (signatureHeader === undefined) return false;
  const { timestamp, v1 } = parseSignatureHeader(signatureHeader);
  if (timestamp === null || v1.length === 0) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(now / 1_000 - timestampSeconds) > MAX_AGE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return v1.some((candidate) => safeEqual(expected, candidate));
}

/** Monta o cabeçalho `Stripe-Signature` (usado só em testes, para simular um webhook real do Stripe). */
export function signStripePayload(secret: string, rawBody: string, timestampSeconds: number): string {
  const signature = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}
