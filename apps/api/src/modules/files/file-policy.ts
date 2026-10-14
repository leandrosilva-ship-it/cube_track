/** Tipos de arquivo aceitos (lista de permissão) e extensões esperadas. Executáveis e SVG são bloqueados. */
export const ALLOWED_MIME_TYPES: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'text/plain': ['txt', 'log'],
  'text/csv': ['csv'],
  'application/zip': ['zip'],
  'application/msword': ['doc'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.oasis.opendocument.text': ['odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods'],
  'application/vnd.oasis.opendocument.presentation': ['odp'],
  'video/mp4': ['mp4'],
  'audio/mpeg': ['mp3'],
};

export interface FileCheck {
  ok: boolean;
  reason?: string;
}

export function checkFile(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  maxBytes: number,
): FileCheck {
  if (sizeBytes <= 0) return { ok: false, reason: 'Arquivo vazio.' };
  if (sizeBytes > maxBytes)
    return {
      ok: false,
      reason: `Arquivo excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`,
    };
  const extensions = ALLOWED_MIME_TYPES[mimeType];
  if (extensions === undefined)
    return { ok: false, reason: `Tipo de arquivo não permitido: ${mimeType}.` };
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : undefined;
  if (extension === undefined || !extensions.includes(extension)) {
    return { ok: false, reason: 'A extensão do arquivo não corresponde ao tipo informado.' };
  }
  if (/[\p{Cc}/\\]/u.test(fileName) || fileName.length > 255)
    return { ok: false, reason: 'Nome de arquivo inválido.' };
  return { ok: true };
}
