'use client';

import { LOCALE_LABELS, LOCALES, type Locale } from '@cube-track/i18n';
import { Select } from '@cube-track/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';

/** Troca de idioma preservando a rota atual (navegação client-side). */
export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('shell.user');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (
    <Select
      aria-label={t('language')}
      value={locale}
      {...(className === undefined ? {} : { className })}
      options={LOCALES.map((value) => ({ value, label: LOCALE_LABELS[value] }))}
      onValueChange={(value) => {
        startTransition(() => {
          router.replace(`${pathname}${window.location.search}`, { locale: value as Locale });
        });
      }}
    />
  );
}
