'use client';

import { formatDateTime } from '@cube-track/i18n';
import { Avatar, Button, DatePicker, EmptyState, Select, Skeleton } from '@cube-track/ui';
import { History } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import type { ActivityLogEntry, BoardDetail, Item } from '@/lib/api/types';

import { useActivityActors, useActivityLog } from './hooks';

type ItemPanelTranslator = ReturnType<typeof useTranslations<'itemPanel'>>;

function describeEntry(entry: ActivityLogEntry, t: ItemPanelTranslator): string {
  const columnTitle = entry.columnKey ?? entry.action;
  switch (entry.action) {
    case 'item.renamed':
      return t('activity.renamed', {
        from: stringify((entry.oldValue as { name?: string } | null)?.name),
        to: stringify((entry.newValue as { name?: string } | null)?.name),
      });
    case 'checklist_item.toggle':
      return t('activity.checklistToggled', { content: stringify((entry.newValue as { content?: string } | null)?.content) });
    case 'file.uploaded':
      return t('activity.fileUploaded', { name: stringify((entry.newValue as { fileName?: string } | null)?.fileName) });
    case 'file.delete':
      return t('activity.fileDeleted', { name: stringify((entry.oldValue as { fileName?: string } | null)?.fileName) });
    case 'approval.request':
      return t('activity.approvalRequested');
    case 'approval.decide': {
      const decision = (entry.newValue as { decision?: string } | null)?.decision;
      const word =
        decision === 'approved'
          ? t('activity.decisionApproved')
          : decision === 'rejected'
            ? t('activity.decisionRejected')
            : t('activity.decisionOther');
      return t('activity.approvalDecided', { decision: word });
    }
    case 'item.dependencies_changed':
      return t('activity.dependenciesChanged');
    default:
      return t('activity.fieldChanged', {
        column: columnTitle,
        from: stringify(entry.oldValue),
        to: stringify(entry.newValue),
      });
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.labelId === 'string') return record.labelId;
    if (typeof record.name === 'string') return record.name;
  }
  return JSON.stringify(value);
}

/** Aba "Log de atividade": todas as mudanças de campo (quem/quando/de→para), com filtros. */
export function ActivityTab({ board, item }: { board: BoardDetail; item: Item }) {
  const t = useTranslations('itemPanel');
  const locale = useLocale();
  const actors = useActivityActors(item.id);
  const [actorId, setActorId] = useState<string | undefined>(undefined);
  const [columnKey, setColumnKey] = useState<string | undefined>(undefined);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const filters = useMemo(
    () => ({
      ...(actorId === undefined ? {} : { actorId }),
      ...(columnKey === undefined ? {} : { columnKey }),
      ...(from === null ? {} : { from: `${from}T00:00:00.000Z` }),
      ...(to === null ? {} : { to: `${to}T23:59:59.999Z` }),
    }),
    [actorId, columnKey, from, to],
  );
  const log = useActivityLog(item.id, filters);

  const columnOptions = [
    { value: 'all', label: t('activity.allColumns') },
    { value: 'name', label: t('fields.name') },
    ...board.columns.map((column) => ({ value: column.key, label: column.title })),
  ];
  const actorOptions = [
    { value: 'all', label: t('activity.allUsers') },
    ...(actors.data ?? []).map((actor) => ({ value: actor.id, label: actor.name })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          aria-label={t('activity.filterUser')}
          value={actorId ?? 'all'}
          onValueChange={(value) => {
            setActorId(value === 'all' ? undefined : value);
          }}
          options={actorOptions}
          className="w-44"
        />
        <Select
          aria-label={t('activity.filterColumn')}
          value={columnKey ?? 'all'}
          onValueChange={(value) => {
            setColumnKey(value === 'all' ? undefined : value);
          }}
          options={columnOptions}
          className="w-44"
        />
        <DatePicker
          value={from}
          onChange={setFrom}
          label={t('activity.filterFrom')}
          placeholder={t('activity.filterFrom')}
          clearLabel={t('cancel')}
          className="w-36"
        />
        <DatePicker
          value={to}
          onChange={setTo}
          label={t('activity.filterTo')}
          placeholder={t('activity.filterTo')}
          clearLabel={t('cancel')}
          className="w-36"
        />
        {actorId !== undefined || columnKey !== undefined || from !== null || to !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActorId(undefined);
              setColumnKey(undefined);
              setFrom(null);
              setTo(null);
            }}
          >
            {t('activity.clearFilters')}
          </Button>
        ) : null}
      </div>
      {log.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : log.data === undefined || log.data.data.length === 0 ? (
        <EmptyState icon={<History aria-hidden="true" />} title={t('activity.empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {log.data.data.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <Avatar person={{ id: entry.actorId ?? 'system', name: entry.actorName ?? t('system') }} size="xs" />
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium">{entry.actorName ?? t('system')}</span>{' '}
                  {describeEntry(entry, t)}
                </p>
                <p className="text-xs text-fg-subtle">{formatDateTime(entry.createdAt, locale)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
