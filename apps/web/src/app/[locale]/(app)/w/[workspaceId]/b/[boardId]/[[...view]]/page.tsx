import { BoardPage } from '@/features/board/board-page';

export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; boardId: string; view?: string[] }>;
}) {
  const { workspaceId, boardId, view } = await params;
  return (
    <BoardPage
      key={boardId}
      workspaceId={workspaceId}
      boardId={boardId}
      viewId={view?.[0] ?? null}
    />
  );
}
