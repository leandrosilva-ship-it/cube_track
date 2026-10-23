'use client';

import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  EmptyState,
  Skeleton,
  DropdownMenuTrigger,
  toast,
} from '@cube-track/ui';
import { DASHBOARD_GRID_COLUMNS } from '@cube-track/shared';
import { Download, FileImage, LayoutDashboard, MoreVertical, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type { Widget } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { useDashboardRealtime } from '@/realtime/provider';

import {
  useDashboard,
  useDashboardData,
  useDashboardWidgets,
  useDeleteWidget,
  useUpdateWidget,
} from './hooks';
import { sortWidgetsByPosition } from './model';
import { ProjectHealthDialog } from './project-health-dialog';
import { WidgetCard } from './widget-card';
import { WidgetDialog } from './widget-dialog';

export interface DashboardViewProps {
  dashboardId: string;
}

/** Dashboard standalone ou embutido na aba de view de um board (ADR 0050). */
export function DashboardView({ dashboardId }: DashboardViewProps) {
  const t = useTranslations('dashboards');
  const errorMessage = useErrorMessage();
  useDashboardRealtime(dashboardId);

  const dashboardQuery = useDashboard(dashboardId);
  const widgetsQuery = useDashboardWidgets(dashboardId);
  const dataQuery = useDashboardData(dashboardId, dashboardQuery.data?.refreshIntervalSeconds);
  const updateWidget = useUpdateWidget(dashboardId);
  const deleteWidget = useDeleteWidget(dashboardId);
  const gridRef = useRef<HTMLDivElement>(null);

  const [widgetDialog, setWidgetDialog] = useState<'closed' | 'create' | Widget>('closed');
  const [healthBoardId, setHealthBoardId] = useState<string | null>(null);

  if (dashboardQuery.isPending || widgetsQuery.isPending) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-3 h-24" />
          <Skeleton className="col-span-3 h-24" />
          <Skeleton className="col-span-6 h-24" />
        </div>
      </div>
    );
  }
  if (dashboardQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <EmptyState icon={<LayoutDashboard aria-hidden="true" />} title={t('notFound')} />
      </div>
    );
  }

  const dashboard = dashboardQuery.data;
  const widgets = sortWidgetsByPosition(widgetsQuery.data ?? []);
  const dataByWidget = new Map((dataQuery.data ?? []).map((entry) => [entry.widgetId, entry.data]));

  const move = async (index: number, direction: -1 | 1) => {
    const other = widgets[index + direction];
    const current = widgets[index];
    if (other === undefined || current === undefined) return;
    try {
      await Promise.all([
        updateWidget.mutateAsync({ id: current.id, input: { layout: other.layout } }),
        updateWidget.mutateAsync({ id: other.id, input: { layout: current.layout } }),
      ]);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const exportPng = async () => {
    const node = gridRef.current;
    if (node === null) return;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `${dashboard.name}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const exportPdf = async () => {
    const node = gridRef.current;
    if (node === null) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff' });
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'l' : 'p',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${dashboard.name}.pdf`);
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{dashboard.name}</h2>
          {dashboard.description !== null ? (
            <p className="text-sm text-fg-muted">{dashboard.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dashboard.canEdit ? (
            <Button
              size="sm"
              onClick={() => {
                setWidgetDialog('create');
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('addWidget')}
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary">
                <MoreVertical className="size-4" aria-hidden="true" />
                {t('moreActions')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  void exportPng();
                }}
              >
                <FileImage className="size-4" aria-hidden="true" />
                {t('menu.exportPng')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void exportPdf();
                }}
              >
                <Download className="size-4" aria-hidden="true" />
                {t('menu.exportPdf')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {widgets.length === 0 ? (
        <EmptyState
          icon={<LayoutDashboard aria-hidden="true" />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            dashboard.canEdit ? (
              <Button
                onClick={() => {
                  setWidgetDialog('create');
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('addWidget')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          ref={gridRef}
          className="grid auto-rows-[56px] gap-4"
          style={{ gridTemplateColumns: `repeat(${DASHBOARD_GRID_COLUMNS}, minmax(0, 1fr))` }}
        >
          {widgets.map((widget, index) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              data={dataByWidget.get(widget.id)}
              loading={dataQuery.isPending}
              canEdit={dashboard.canEdit}
              isFirst={index === 0}
              isLast={index === widgets.length - 1}
              onEdit={() => {
                setWidgetDialog(widget);
              }}
              onDelete={() => {
                void deleteWidget.mutateAsync(widget.id).catch((error: unknown) => {
                  toast.error(errorMessage(error));
                });
              }}
              onMoveUp={() => {
                void move(index, -1);
              }}
              onMoveDown={() => {
                void move(index, 1);
              }}
              onReportHealth={setHealthBoardId}
            />
          ))}
        </div>
      )}

      <Dialog
        open={widgetDialog !== 'closed'}
        onOpenChange={(open) => {
          if (!open) setWidgetDialog('closed');
        }}
      >
        {widgetDialog !== 'closed' ? (
          <WidgetDialog
            dashboardId={dashboardId}
            workspaceId={dashboard.workspaceId}
            boardIds={dashboard.sourceBoardIds}
            existingWidgets={widgets}
            {...(widgetDialog === 'create' ? {} : { widget: widgetDialog })}
            onClose={() => {
              setWidgetDialog('closed');
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={healthBoardId !== null}
        onOpenChange={(open) => {
          if (!open) setHealthBoardId(null);
        }}
      >
        {healthBoardId !== null ? (
          <ProjectHealthDialog
            boardId={healthBoardId}
            onClose={() => {
              setHealthBoardId(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
