/**
 * CSV (RFC 4180) sem dependências. pt-BR/es usam `;` (padrão do Excel no Brasil) e BOM UTF-8 para o
 * Excel reconhecer a codificação; en usa `,`. A leitura detecta o separador (`;`, `,` ou tab).
 */

export type CsvDelimiter = ',' | ';' | '\t';

const BOM = String.fromCharCode(0xfeff);

/** Separador mais frequente fora de aspas na primeira linha. */
export function detectCsvDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && (char === ',' || char === ';' || char === '\t')) counts[char] += 1;
  }
  const best = (Object.entries(counts) as [CsvDelimiter, number][]).sort((a, b) => b[1] - a[1])[0];
  return best !== undefined && best[1] > 0 ? best[0] : ',';
}

/** Lê CSV em linhas de células (aspas, `""` escapado, quebras de linha dentro de aspas, CRLF). */
export function parseCsv(
  input: string,
  delimiter: CsvDelimiter = detectCsvDelimiter(input),
): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

/** Gera CSV com BOM e CRLF; o separador segue o idioma. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  locale: string,
): string {
  const separator = locale === 'en' ? ',' : ';';
  const escape = (value: string) =>
    /["\n\r]/.test(value) || value.includes(separator) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [header, ...rows].map((row) => row.map(escape).join(separator));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
