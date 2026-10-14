'use client';

import {
  Badge,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  cn,
  toast,
} from '@cube-track/ui';
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  FileText,
  FolderOpen,
  GanttChart,
  Kanban,
  LayoutDashboard,
  Map,
  Plus,
  Table2,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Link, useRouter } from '@/i18n/navigation';
import type { BoardView, ViewType } from '@/lib/api/types';

import { useCreateView, useDeleteView } from './hooks';

export const VIEW_ICONS: Record<ViewType, LucideIcon> = {
  table: Table2,
  kanban: Kanban,
  calendar: CalendarDays,
  timeline: GanttChart,
  gantt: GanttChart,
  form: FileText,
  map: Map,
  chart: BarChart3,
  files: FolderOpen,
  workload: Users,
  dashboard: LayoutDashboard,
};

const CREATABLE: ViewType[] = [
  'table',
  'kanban',
  'calendar',
  'timeline',
  'gantt',
  'form',
  'chart',
  'files',
  'workload',
];

interface ViewTabsProps {
  workspaceId: string;
  boardId: string;
  views: readonly BoardView[];
  activeViewId: string | null;
  canManage: boolean;
}

/** Abas de views (cada uma é uma URL — navegação sem recarregar), "+" para criar e "Todas". */
export function ViewTabs({ workspaceId, boardId, views, activeViewId, canManage }: ViewTabsProps) {
  const t = useTranslations('board.views');
  const tc = useTranslations('common');
  const router = useRouter();
  const create = useCreateView(boardId);
  const remove = useDeleteView(boardId);
  const [personal, setPersonal] = useState(!canManage);
  const href = (viewId: string) => `/w/${workspaceId}/b/${boardId}/${viewId}`;
  const visibleTabs = views.slice(0, 6);

  const createView = (type: ViewType) => {
    const name = t('newName', { type: t(`types.${type}`) });
    create.mutate(
      { name, type, personal: personal || !canManage },
      {
        onSuccess: (view) => {
          toast.success(t('created', { name: view.name }));
          router.push(href(view.id));
        },
      },
    );
  };

  return (
    <div className="flex items-center gap-1 border-b border-border px-4 sm:px-6">
      <nav
        aria-label={t('label')}
        className="-mb-px flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {visibleTabs.map((view) => {
          const Icon = VIEW_ICONS[view.type];
          const active = view.id === activeViewId;
          return (
            <Link
              key={view.id}
              href={href(view.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-fg-muted hover:text-fg',
                active && 'border-primary text-fg',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span className="max-w-40 truncate">{view.name}</span>
              {view.personal ? <span className="sr-only">({t('personal')})</span> : null}
            </Link>
          );
        })}
      </nav>
      {views.length > visibleTabs.length || views.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg">
            {t('all')}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72">
            <DropdownMenuLabel>{t('all')}</DropdownMenuLabel>
            {views.map((view) => {
              const Icon = VIEW_ICONS[view.type];
              return (
                <DropdownMenuItem
                  key={view.id}
                  icon={<Icon aria-hidden="true" />}
                  onSelect={() => {
                    router.push(href(view.id));
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate">{view.name}</span>
                    {view.isDefault ? <Badge>{t('default')}</Badge> : null}
                    {view.personal ? <Badge tone="info">{t('personal')}</Badge> : null}
                  </span>
                </DropdownMenuItem>
              );
            })}
            {views.some((view) => view.canEdit && !view.isDefault) ? (
              <DropdownMenuSeparator />
            ) : null}
            {views
              .filter((view) => view.canEdit && !view.isDefault)
              .map((view) => (
                <DropdownMenuItem
                  key={`delete-${view.id}`}
                  destructive
                  icon={<Trash2 aria-hidden="true" />}
                  onSelect={() => {
                    if (!window.confirm(t('deleteConfirm', { name: view.name }))) return;
                    remove.mutate(view.id, {
                      onSuccess: () => {
                        if (view.id === activeViewId) router.push(`/w/${workspaceId}/b/${boardId}`);
                      },
                    });
                  }}
                >
                  {tc('delete')}: {view.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('add')}
            icon={<Plus aria-hidden="true" />}
            size="icon-sm"
            loading={create.isPending}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuLabel>{t('add')}</DropdownMenuLabel>
          {CREATABLE.map((type) => {
            const Icon = VIEW_ICONS[type];
            return (
              <DropdownMenuItem
                key={type}
                icon={<Icon aria-hidden="true" />}
                onSelect={() => {
                  createView(type);
                }}
              >
                {t(`types.${type}`)}
              </DropdownMenuItem>
            );
          })}
          {canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={personal}
                onCheckedChange={(checked) => {
                  setPersonal(checked);
                }}
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                {t('createPersonal')}
              </DropdownMenuCheckboxItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
