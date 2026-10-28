import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CapacityPage } from '@/features/resources/capacity-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('capacity');
  return { title: t('pageTitle') };
}

export default function Page() {
  return <CapacityPage />;
}
