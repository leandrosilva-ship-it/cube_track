import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FavoritesPage } from '@/features/favorites/favorites-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('favorites');
  return { title: t('title') };
}

export default function Page() {
  return <FavoritesPage />;
}
