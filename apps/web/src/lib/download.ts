/** Baixa um texto gerado no cliente (ex.: CSV da seleção) como arquivo. */
export function downloadText(
  filename: string,
  content: string,
  type = 'text/csv;charset=utf-8',
): void {
  downloadBlob(filename, new Blob([content], { type }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);
}
