import { WorkspacePage } from '@/features/workspace/workspace-page';

export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  return <WorkspacePage key={workspaceId} workspaceId={workspaceId} />;
}
