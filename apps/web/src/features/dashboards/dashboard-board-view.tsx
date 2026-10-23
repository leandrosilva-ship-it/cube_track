'use client';

import { DashboardConfigSchema } from '@cube-track/shared';
import { Button, EmptyState, toast } from '@cube-track/ui';
import { LayoutDashboard } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useUpdateView } from '../board/hooks';
import type { BoardDetail, BoardView } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { DashboardView } from './dashboard-view';
import { useCreateDashboard } from './hooks';

export interface DashboardBoardViewProps {
  board: BoardDetail;
  view: BoardView;
}

/**
 * View `dashboard` embutida nas abas do board: referencia um dashboard de workspace (ADR 0050).
 * A primeira abertura cria o dashboard (fonte = este board) e grava `config.dashboardId` na view,
 * mesmo padrão de "criar ao abrir" da view Formulário.
 */
export function DashboardBoardView({ board, view }: DashboardBoardViewProps) {
  const t = useTranslations('dashboards');
  const config = DashboardConfigSchema.parse(view.config);
  const updateView = useUpdateView(board.id);
  const createDashboard = useCreateDashboard(board.workspaceId);
  const errorMessage = useErrorMessage();

  const create = async () => {
    try {
      const created = await createDashboard.mutateAsync({ name: view.name, sourceBoardIds: [board.id] });
      updateView.mutate({ viewId: view.id, input: { config: { dashboardId: created.id } } });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (config.dashboardId === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<LayoutDashboard aria-hidden="true" />}
          title={t('createTitle')}
          description={t('createDescription')}
          action={
            <Button
              loading={createDashboard.isPending}
              onClick={() => {
                void create();
              }}
            >
              {t('create')}
            </Button>
          }
        />
      </div>
    );
  }

  return <DashboardView dashboardId={config.dashboardId} />;
}
