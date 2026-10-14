import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { SignupForm } from '@/features/auth/components/signup-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('signup.title') };
}

export default function Page() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
