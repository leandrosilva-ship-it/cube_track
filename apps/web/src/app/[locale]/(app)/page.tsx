import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { HomePage } from '@/features/home/home-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('shell.nav');
  return { title: t('home') };
}

export default function Page() {
  return <HomePage />;
}
