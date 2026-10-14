import { isLocale, MESSAGES } from '@cube-track/i18n';
import { getRequestConfig } from 'next-intl/server';
import { locale as rootLocale } from 'next/root-params';

import { routing } from './routing';

/** Idioma da requisição: override explícito (`getTranslations({ locale })`) ou o segmento [locale]. */
export default getRequestConfig(async ({ locale: override }) => {
  const requested = override ?? (await rootLocale());
  const locale = isLocale(requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: MESSAGES[locale],
    timeZone: 'America/Sao_Paulo',
  };
});
