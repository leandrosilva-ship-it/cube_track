import { DashboardView } from '@/features/dashboards/dashboard-view';

export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; dashboardId: string }>;
}) {
  const { dashboardId } = await params;
  return <DashboardView key={dashboardId} dashboardId={dashboardId} />;
}
