import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { WeekPage } from '@/features/week/week-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('week');
  return { title: t('title') };
}

export default function Page() {
  return <WeekPage />;
}
