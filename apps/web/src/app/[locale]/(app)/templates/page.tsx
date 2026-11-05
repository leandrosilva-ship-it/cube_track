import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { TemplatesPage } from '@/features/templates/templates-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('templates');
  return { title: t('title') };
}

export default function Page() {
  return <TemplatesPage />;
}
