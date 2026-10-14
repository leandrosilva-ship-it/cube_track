/** Idiomas suportados (pt-BR é o padrão e a fonte da verdade das chaves de mensagem). */
export const LOCALES = ['pt-BR', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'pt-BR';

/** Nome de cada idioma no próprio idioma (seletor de idioma). */
export const LOCALE_LABELS: Record<Locale, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  es: 'Español',
};

/** Moeda padrão por idioma (o tenant pode sobrescrever). */
export const DEFAULT_CURRENCY: Record<Locale, string> = {
  'pt-BR': 'BRL',
  en: 'BRL',
  es: 'BRL',
};

export function isLocale(value: string | null | undefined): value is Locale {
  return value !== null && value !== undefined && (LOCALES as readonly string[]).includes(value);
}

/** Escolhe o melhor idioma suportado a partir de um Accept-Language (ou similar). */
export function matchLocale(header: string | null | undefined): Locale {
  if (header === null || header === undefined || header === '') return DEFAULT_LOCALE;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const quality = params.find((param) => param.trim().startsWith('q='));
      return {
        tag: tag.toLowerCase(),
        q: quality === undefined ? 1 : Number(quality.trim().slice(2)),
      };
    })
    .filter((candidate) => candidate.tag !== '' && Number.isFinite(candidate.q))
    .sort((a, b) => b.q - a.q);
  for (const { tag } of candidates) {
    if (tag === 'pt-br' || tag === 'pt') return 'pt-BR';
    if (tag.startsWith('pt-')) return 'pt-BR';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
    if (tag === 'es' || tag.startsWith('es-')) return 'es';
  }
  return DEFAULT_LOCALE;
}
