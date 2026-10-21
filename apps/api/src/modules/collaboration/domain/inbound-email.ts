/**
 * Corta o conteúdo citado de uma resposta por e-mail (ADR 0048): a maioria dos clientes de e-mail
 * mantém a mensagem nova acima da citação, marcada por um separador comum (linhas "De:"/"On ...
 * wrote:", "-----Original Message-----" ou um bloco de linhas iniciadas por "&gt;"). Heurística
 * simples e intencionalmente conservadora — provedores de "inbound parse" (SendGrid, Mailgun,
 * Postmark…) já entregam esse corte em um campo próprio quando configurados; isto é a rede de
 * segurança para quando só o corpo bruto está disponível.
 */
const QUOTE_MARKERS = [
  /^-{2,}\s*original message\s*-{2,}/i,
  /^-{2,}\s*mensagem original\s*-{2,}/i,
  /^on .+ wrote:$/i,
  /^em .+ escreveu:$/i,
  /^de:\s*.+$/i,
  /^from:\s*.+$/i,
];

export function stripQuotedReply(rawText: string): string {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) break;
    if (QUOTE_MARKERS.some((marker) => marker.test(trimmed))) break;
    kept.push(line);
  }
  return kept.join('\n').trim();
}
