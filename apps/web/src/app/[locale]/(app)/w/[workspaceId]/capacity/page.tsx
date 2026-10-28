import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CapacityPage } from '@/features/resources/capacity-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('capacity');
  return { title: t('pageTitle') };
}

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <CapacityPage key={workspaceId} workspaceId={workspaceId} />;
}
