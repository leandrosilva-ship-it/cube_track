import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ContractsPage } from '@/features/contracts/contracts-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contracts');
  return { title: t('pageTitle') };
}

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <ContractsPage key={workspaceId} workspaceId={workspaceId} />;
}
