import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { MagicLinkVerifier } from '@/features/auth/components/token-flows';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('magic.verifying') };
}

export default function Page() {
  return (
    <Suspense>
      <MagicLinkVerifier />
    </Suspense>
  );
}
