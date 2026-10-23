'use client';

import { Button, Dialog, EmptyState, Skeleton } from '@cube-track/ui';
import { LayoutDashboard, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Link, useRouter } from '@/i18n/navigation';

import { CreateDashboardDialog } from './create-dashboard-dialog';
import { useDashboards } from './hooks';

/** Lista de dashboards do workspace (entrada standalone, fora de um board), ADR 0050. */
export function DashboardsListPage({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('dashboards');
  const router = useRouter();
  const dashboardsQuery = useDashboards(workspaceId);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="pb-10">
      <PageHeader
        title={t('title')}
        actions={
          <Button
            onClick={() => {
              setCreateOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('create')}
          </Button>
        }
      />
      <div className="px-4 sm:px-8">
        {dashboardsQuery.data === undefined ? (
          <Skeleton className="h-32" />
        ) : dashboardsQuery.data.length === 0 ? (
          <EmptyState
            icon={<LayoutDashboard aria-hidden="true" />}
            title={t('createTitle')}
            description={t('createDescription')}
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {dashboardsQuery.data.map((dashboard) => (
              <li key={dashboard.id}>
                <Link
                  href={`/w/${workspaceId}/dashboards/${dashboard.id}`}
                  className="flex h-full flex-col gap-1 rounded-lg border border-border bg-surface p-3 hover:border-primary hover:bg-surface-hover"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <LayoutDashboard className="size-4 text-primary" aria-hidden="true" />
                    {dashboard.name}
                  </span>
                  {dashboard.description === null ? null : (
                    <span className="line-clamp-2 text-sm text-fg-muted">{dashboard.description}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
      >
        {createOpen ? (
          <CreateDashboardDialog
            workspaceId={workspaceId}
            onCreated={(dashboardId) => {
              setCreateOpen(false);
              router.push(`/w/${workspaceId}/dashboards/${dashboardId}`);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
