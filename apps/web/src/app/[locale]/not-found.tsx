import { Button, LogoMark } from '@cube-track/ui';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

export default async function NotFound() {
  const t = await getTranslations('common');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <LogoMark className="size-12" decorative />
      <h1 className="text-2xl font-semibold">{t('pageNotFound')}</h1>
      <p className="max-w-sm text-sm text-fg-muted">{t('pageNotFoundDescription')}</p>
      <Button asChild>
        <Link href="/">{t('goHome')}</Link>
      </Button>
    </main>
  );
}
