import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { EmailVerifier } from '@/features/auth/components/token-flows';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('verifyEmail.verifying') };
}

export default function Page() {
  return (
    <Suspense>
      <EmailVerifier />
    </Suspense>
  );
}
