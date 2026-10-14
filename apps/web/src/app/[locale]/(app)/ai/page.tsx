import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AiPage } from '@/features/ai/ai-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('ai');
  return { title: t('title') };
}

export default function Page() {
  return <AiPage />;
}
