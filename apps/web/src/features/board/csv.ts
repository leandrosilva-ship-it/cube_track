import type { Locale } from '@cube-track/i18n';

/** Gera CSV (RFC 4180). Em pt-BR/es usa `;` (padrão do Excel no Brasil) e BOM UTF-8. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  locale: Locale,
): string {
  const separator = locale === 'en' ? ',' : ';';
  const escape = (value: string) =>
    /["\n\r]/.test(value) || value.includes(separator) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [header, ...rows].map((row) => row.map(escape).join(separator));
  return `${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`;
}

export function downloadText(
  filename: string,
  content: string,
  type = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);
}
