import type { Metadata, Viewport } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppProviders } from '@/components/providers/app-providers';
import { routing } from '@/i18n/routing';
import { PREFERENCES_BOOT_SCRIPT } from '@/stores/preferences';

import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: 'auth',
  });
  return {
    title: { default: 'CUBE TRACK', template: '%s · CUBE TRACK' },
    description: t('tagline'),
    applicationName: 'CUBE TRACK',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, title: 'CUBE TRACK', statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#12141c' },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Aplica tema/densidade salvos antes da primeira pintura (sem "flash"). */}
        <script dangerouslySetInnerHTML={{ __html: PREFERENCES_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
