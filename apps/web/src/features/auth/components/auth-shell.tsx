import { Logo } from '@cube-track/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { LanguageSwitcher } from '@/components/common/language-switcher';
import { ThemeToggle } from '@/components/common/theme-toggle';

/** Moldura das telas públicas de autenticação (mobile-first a partir de 360 px). */
export async function AuthShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('auth');
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden">
      <header className="flex min-w-0 items-center justify-between gap-2 px-4 py-4 sm:px-8">
        <Logo className="min-w-0" />
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <LanguageSwitcher className="w-32 sm:w-44" />
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-10 sm:items-center">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          {children}
        </div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-fg-muted">{t('tagline')}</footer>
    </div>
  );
}
