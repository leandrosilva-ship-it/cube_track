import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { InviteForm } from '@/features/auth/components/invite-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('invite.accept') };
}

export default function Page() {
  return (
    <Suspense>
      <InviteForm />
    </Suspense>
  );
}
