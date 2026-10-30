'use client';

import { Button, EmptyState, Skeleton } from '@cube-track/ui';
import { Briefcase, FileText, Folder, Gauge, LayoutDashboard, LayoutGrid } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/common/page-header';
import { Link } from '@/i18n/navigation';
import type { TreeBoard } from '@/lib/api/types';

import { useTree, useWorkspaces } from './hooks';

function BoardList({ boards, workspaceId }: { boards: TreeBoard[]; workspaceId: string }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {boards.map((board) => (
        <li key={board.id}>
          <Link
            href={`/w/${workspaceId}/b/${board.id}`}
            className="flex h-full flex-col gap-1 rounded-lg border border-border bg-surface p-3 hover:border-primary hover:bg-surface-hover"
          >
            <span className="flex items-center gap-2 font-medium">
              <LayoutGrid className="size-4 text-primary" aria-hidden="true" />
              {board.name}
            </span>
            {board.description === null ? null : (
              <span className="line-clamp-2 text-sm text-fg-muted">{board.description}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Visão geral do workspace: boards por pasta. */
export function WorkspacePage({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('workspacePage');
  const workspaces = useWorkspaces();
  const tree = useTree(workspaceId);
  const workspace = workspaces.data?.find((entry) => entry.id === workspaceId);
  const byPosition = <T extends { position: string }>(a: T, b: T) =>
    a.position < b.position ? -1 : 1;
  return (
    <div className="pb-10">
      <PageHeader
        title={workspace?.name ?? '…'}
        {...(workspace === undefined || workspace.description === null
          ? {}
          : { subtitle: workspace.description })}
        actions={
          <>
            {tree.data?.canReadPortfolio === true ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/w/${workspaceId}/portfolio`}>
                  <Briefcase className="size-4" aria-hidden="true" />
                  {t('portfolio')}
                </Link>
              </Button>
            ) : null}
            {tree.data?.canReadContracts === true && workspace?.enabledModules.includes('contracts') === true ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/w/${workspaceId}/contracts`}>
                  <FileText className="size-4" aria-hidden="true" />
                  {t('contracts')}
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <Link href={`/w/${workspaceId}/capacity`}>
                <Gauge className="size-4" aria-hidden="true" />
                {t('capacity')}
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/w/${workspaceId}/dashboards`}>
                <LayoutDashboard className="size-4" aria-hidden="true" />
                {t('dashboards')}
              </Link>
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-8 px-4 sm:px-8">
        {tree.data === undefined ? (
          <Skeleton className="h-32" />
        ) : tree.data.boards.length === 0 ? (
          <EmptyState icon={<LayoutGrid aria-hidden="true" />} title={t('empty')} />
        ) : (
          <>
            {[...tree.data.folders].sort(byPosition).map((folder) => {
              const boards = tree.data.boards
                .filter((board) => board.folderId === folder.id)
                .sort(byPosition);
              if (boards.length === 0) return null;
              return (
                <section key={folder.id} aria-labelledby={`folder-${folder.id}`}>
                  <h2
                    id={`folder-${folder.id}`}
                    className="mb-3 flex items-center gap-2 text-base font-semibold"
                  >
                    <Folder className="size-4 text-fg-muted" aria-hidden="true" />
                    {folder.name}
                  </h2>
                  <BoardList boards={boards} workspaceId={workspaceId} />
                </section>
              );
            })}
            {tree.data.boards.some((board) => board.folderId === null) ? (
              <section aria-labelledby="folder-root">
                <h2 id="folder-root" className="mb-3 text-base font-semibold">
                  {t('rootBoards')}
                </h2>
                <BoardList
                  boards={tree.data.boards
                    .filter((board) => board.folderId === null)
                    .sort(byPosition)}
                  workspaceId={workspaceId}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
