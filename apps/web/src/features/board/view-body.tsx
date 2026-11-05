'use client';

import { EmptyState, Skeleton } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';

import type { BoardDetail, BoardView } from '@/lib/api/types';

import { VIEW_ICONS } from './view-tabs';

export interface BoardViewBodyProps {
  board: BoardDetail;
  view: BoardView;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Registro de telas por tipo de view (ADR 0044, ADR 0049, ADR 0052, ADR 0058). Cada view pesada
 * (Tabela, Kanban, Calendário, Timeline, Gantt, Formulário, Dashboard, Workload) é um bundle
 * separado via `next/dynamic` (ADR 0058): trocar de aba só baixa o código da view ativa, nunca o
 * das demais — mesmo padrão já usado para a paleta de comandos e os diálogos do shell
 * (`features/shell/app-shell.tsx`). Os demais tipos (mapa, gráfico, arquivos) ainda mostram
 * "em breve" (mesmo padrão de Integrar/Automatizar/Agentes).
 */
const loadTableView = () => import('../table/table-view').then((module) => module.TableView);
const loadKanbanView = () => import('../kanban/kanban-view').then((module) => module.KanbanView);
const loadCalendarView = () =>
  import('../planning/calendar-view').then((module) => module.CalendarView);
const loadTimelineView = () =>
  import('../planning/timeline-view').then((module) => module.TimelineView);
const loadGanttView = () => import('../planning/gantt-view').then((module) => module.GanttView);
const loadFormBuilderView = () =>
  import('../forms/form-builder-view').then((module) => module.FormBuilderView);
const loadDashboardBoardView = () =>
  import('../dashboards/dashboard-board-view').then((module) => module.DashboardBoardView);
const loadWorkloadView = () =>
  import('../resources/workload-view').then((module) => module.WorkloadView);

const ViewSkeleton = () => (
  <div className="flex flex-col gap-2 p-6" aria-hidden="true">
    <Skeleton className="h-9 w-64" />
    <Skeleton className="h-64 w-full" />
    <Skeleton className="h-64 w-full" />
  </div>
);

const TableView = dynamic(loadTableView, { ssr: false, loading: ViewSkeleton });
const KanbanView = dynamic(loadKanbanView, { ssr: false, loading: ViewSkeleton });
const CalendarView = dynamic(loadCalendarView, { ssr: false, loading: ViewSkeleton });
const TimelineView = dynamic(loadTimelineView, { ssr: false, loading: ViewSkeleton });
const GanttView = dynamic(loadGanttView, { ssr: false, loading: ViewSkeleton });
const FormBuilderView = dynamic(loadFormBuilderView, { ssr: false, loading: ViewSkeleton });
const DashboardBoardView = dynamic(loadDashboardBoardView, { ssr: false, loading: ViewSkeleton });
const WorkloadView = dynamic(loadWorkloadView, { ssr: false, loading: ViewSkeleton });

export function BoardViewBody({ board, view, searchRef }: BoardViewBodyProps) {
  if (view.type === 'table') return <TableView key={board.id} board={board} searchRef={searchRef} />;
  if (view.type === 'kanban') return <KanbanView key={view.id} board={board} view={view} searchRef={searchRef} />;
  if (view.type === 'calendar') return <CalendarView key={view.id} board={board} view={view} />;
  if (view.type === 'timeline') return <TimelineView key={view.id} board={board} view={view} />;
  if (view.type === 'gantt') return <GanttView key={view.id} board={board} view={view} />;
  if (view.type === 'form') return <FormBuilderView key={view.id} board={board} view={view} />;
  if (view.type === 'dashboard') return <DashboardBoardView key={view.id} board={board} view={view} />;
  if (view.type === 'workload') return <WorkloadView key={view.id} board={board} view={view} />;
  return <ComingSoonView type={view.type} />;
}

function ComingSoonView({ type }: { type: BoardView['type'] }) {
  const t = useTranslations('board.views');
  const Icon = VIEW_ICONS[type];
  return (
    <div className="p-6">
      <EmptyState
        icon={<Icon aria-hidden="true" />}
        title={t(`types.${type}`)}
        description={t('comingSoon')}
      />
    </div>
  );
}
