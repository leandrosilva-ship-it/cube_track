/**
 * Eventos oferecidos no construtor de webhooks: um subconjunto curado de `REALTIME_EVENT_TYPES`
 * (ADR 0051) — eventos de infraestrutura interna (presença, sessão, permissão, favoritos,
 * sequência) não fazem sentido para um sistema externo assinante e ficam de fora.
 */
export const WEBHOOK_EVENT_TYPES = [
  'item.created',
  'item.updated',
  'item.deleted',
  'item.button_clicked',
  'group.changed',
  'board.updated',
  'update.created',
  'reply.created',
  'checklist.changed',
  'approval.changed',
  'milestone.changed',
  'baseline.changed',
  'automation.changed',
  'phase.changed',
  'process_config.changed',
  'sla.changed',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookInputBody {
  name: string;
  url: string;
  events: string[];
  headers: Record<string, string>;
  isEnabled: boolean;
}

/** Uma linha do editor de cabeçalhos customizados (chave vazia é descartada ao salvar). */
export interface HeaderRow {
  key: string;
  value: string;
}

export function headersToRows(headers: Record<string, string>): HeaderRow[] {
  return Object.entries(headers).map(([key, value]) => ({ key, value }));
}

export function rowsToHeaders(rows: readonly HeaderRow[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key !== '') headers[key] = row.value;
  }
  return headers;
}
