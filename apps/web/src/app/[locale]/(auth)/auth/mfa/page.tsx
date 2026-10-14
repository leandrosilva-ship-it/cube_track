import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { MfaForm } from '@/features/auth/components/mfa-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('mfa.title') };
}

export default function Page() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
