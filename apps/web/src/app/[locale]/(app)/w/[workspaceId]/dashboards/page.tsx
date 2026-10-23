import { DashboardsListPage } from '@/features/dashboards/dashboards-list-page';

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <DashboardsListPage key={workspaceId} workspaceId={workspaceId} />;
}
