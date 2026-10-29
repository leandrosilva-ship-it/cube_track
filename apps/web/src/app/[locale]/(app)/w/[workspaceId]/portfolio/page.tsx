import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PortfolioPage } from '@/features/portfolio/portfolio-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('portfolio');
  return { title: t('pageTitle') };
}

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <PortfolioPage key={workspaceId} workspaceId={workspaceId} />;
}
