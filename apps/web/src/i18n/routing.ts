import { DEFAULT_LOCALE, LOCALES } from '@cube-track/i18n';
import { defineRouting } from 'next-intl/routing';

/** pt-BR sem prefixo (`/`), en e es com prefixo (`/en`, `/es`). */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeCookie: { name: 'ct_locale', maxAge: 60 * 60 * 24 * 365 },
});
