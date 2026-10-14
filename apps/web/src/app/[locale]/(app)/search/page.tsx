import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { SearchPage } from '@/features/search/search-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('search');
  return { title: t('title') };
}

export default function Page() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  );
}
