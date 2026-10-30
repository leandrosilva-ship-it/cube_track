import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { WorkspaceSettingsPage } from '@/features/workspace/workspace-settings-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspaceSettings');
  return { title: t('pageTitle') };
}

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <WorkspaceSettingsPage key={workspaceId} workspaceId={workspaceId} />;
}
