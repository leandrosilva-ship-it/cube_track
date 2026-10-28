'use client';

import { formatDate } from '@cube-track/i18n';
import { dateRange, isoWeekStart, shiftDays } from '@cube-track/shared';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  toast,
} from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, Download, Plus, Search, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import { api } from '@/lib/api/client';
import type { SearchHit, TimeEntry } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';
import { useSession } from '@/stores/session';

import {
  hoursToMinutes,
  minutesToHours,
  timeEntriesExportUrl,
  useCreateTimeEntry,
  useDeleteTimeEntry,
  useItemNames,
  useSubmitTimesheetWeek,
  useTimeEntriesOfUser,
  useTimesheetApprovalsOfUser,
  useUpdateTimeEntry,
} from './model';

interface RowKey {
  boardId: string;
  itemId: string;
}

function rowKeyOf(entry: RowKey): string {
  return `${entry.boardId}:${entry.itemId}`;
}

function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Célula de horas do dia: edição local, confirma com Enter/blur (evita gravar a cada tecla). */
function HourCell({
  entry,
  locked,
  onCommit,
  label,
}: {
  entry: TimeEntry | undefined;
  locked: boolean;
  onCommit: (hours: number) => void;
  label: string;
}) {
  const serverValue = entry === undefined ? '' : String(minutesToHours(entry.minutes));
  const [value, setValue] = useState(serverValue);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setValue(serverValue);
  }, [serverValue]);

  const commit = () => {
    focused.current = false;
    const parsed = value.trim() === '' ? 0 : Number(value.replace(',', '.'));
    const current = entry === undefined ? 0 : minutesToHours(entry.minutes);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) {
      setValue(serverValue);
      return;
    }
    if (parsed === current) return;
    onCommit(parsed);
  };

  return (
    <Input
      type="number"
      min={0}
      max={24}
      step={0.25}
      inputMode="decimal"
      aria-label={label}
      disabled={locked}
      value={value}
      className="h-9 w-full text-center tabular-nums"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        setValue(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

function ItemSearchPopover({ onPick }: { onPick: (hit: SearchHit) => void }) {
  const t = useTranslations('timesheet');
  const [query, setQuery] = useState('');
  const results = useQuery({
    queryKey: qk.search(`timesheet:${query}`),
    queryFn: () =>
      api<{ data: SearchHit[] }>('/v1/search', { query: { q: query, limit: 10 } }).then(
        (response) => response.data.filter((hit) => hit.type === 'items'),
      ),
    enabled: query.trim().length >= 2,
  });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          {t('grid.addItem')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t('grid.addItem')}>
        <div className="flex w-72 flex-col gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={t('grid.searchPlaceholder')}
              aria-label={t('grid.searchPlaceholder')}
              className="ps-8"
            />
          </div>
          {query.trim().length < 2 ? (
            <p className="px-1 text-xs text-fg-subtle">{t('grid.searchHint')}</p>
          ) : results.data === undefined ? (
            <Skeleton className="h-16" />
          ) : results.data.length === 0 ? (
            <p className="px-1 text-xs text-fg-subtle">{t('grid.searchEmpty')}</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {results.data.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className="block w-full truncate rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-hover"
                    onClick={() => {
                      onPick(hit);
                    }}
                  >
                    {hit.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Apontamento semanal: linhas por item, colunas pelos 7 dias da semana ISO (segunda a domingo). */
export function WeeklyTimesheetGrid() {
  const t = useTranslations('timesheet');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const userId = useSession((state) => state.user?.id ?? null);
  const [weekStart, setWeekStart] = useState(() => isoWeekStart(todayIso()));
  const weekEnd = shiftDays(weekStart, 6);
  const days = useMemo(() => dateRange(weekStart, weekEnd), [weekStart, weekEnd]);
  const [extraRows, setExtraRows] = useState<(RowKey & { itemName: string })[]>([]);

  const entriesQuery = useTimeEntriesOfUser(userId, weekStart, weekEnd);
  const approvalsQuery = useTimesheetApprovalsOfUser(userId);
  const approval = approvalsQuery.data?.find((entry) => entry.periodStart === weekStart);
  const locked = approval?.status === 'submitted' || approval?.status === 'approved';

  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const itemRows = useMemo(() => {
    const seen = new Map<string, RowKey>();
    for (const entry of entries) seen.set(rowKeyOf(entry), { boardId: entry.boardId, itemId: entry.itemId });
    for (const extra of extraRows) if (!seen.has(rowKeyOf(extra))) seen.set(rowKeyOf(extra), extra);
    return [...seen.values()];
  }, [entries, extraRows]);
  const itemNames = useItemNames(itemRows.map((row) => row.itemId));

  const create = useCreateTimeEntry();
  const update = useUpdateTimeEntry();
  const remove = useDeleteTimeEntry();
  const submit = useSubmitTimesheetWeek();

  const entryAt = (row: RowKey, date: string) =>
    entries.find((entry) => entry.boardId === row.boardId && entry.itemId === row.itemId && entry.entryDate === date);

  const totalMinutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  const commitCell = (row: RowKey, date: string, hours: number) => {
    const existing = entryAt(row, date);
    if (hours <= 0) {
      if (existing !== undefined) remove.mutate({ id: existing.id, entry: existing });
      return;
    }
    const minutes = hoursToMinutes(hours);
    if (existing === undefined) {
      create.mutate({ boardId: row.boardId, itemId: row.itemId, entryDate: date, minutes });
    } else if (existing.minutes !== minutes) {
      update.mutate({ id: existing.id, input: { minutes } });
    }
  };

  const removeRow = (row: RowKey) => {
    for (const date of days) {
      const existing = entryAt(row, date);
      if (existing !== undefined) remove.mutate({ id: existing.id, entry: existing });
    }
    setExtraRows((current) => current.filter((entry) => rowKeyOf(entry) !== rowKeyOf(row)));
  };

  const handleSubmit = async () => {
    try {
      await submit.mutateAsync(weekStart);
      toast.success(t('grid.submitted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          label={t('grid.previousWeek')}
          icon={<ChevronLeft aria-hidden="true" />}
          variant="secondary"
          onClick={() => {
            setWeekStart((value) => shiftDays(value, -7));
          }}
        />
        <Button
          variant="secondary"
          onClick={() => {
            setWeekStart(isoWeekStart(todayIso()));
          }}
        >
          {t('grid.currentWeek')}
        </Button>
        <IconButton
          label={t('grid.nextWeek')}
          icon={<ChevronRight aria-hidden="true" />}
          variant="secondary"
          onClick={() => {
            setWeekStart((value) => shiftDays(value, 7));
          }}
        />
        <p className="text-sm font-medium text-fg-muted">
          {t('grid.weekRange', {
            from: formatDate(weekStart, locale, { style: 'dayMonth' }),
            to: formatDate(weekEnd, locale, { style: 'dayMonth' }),
          })}
        </p>
        <div className="ms-auto flex items-center gap-2">
          {approval !== undefined ? <ApprovalBadge status={approval.status} /> : null}
          {userId === null ? null : (
            <Button asChild variant="secondary" size="icon">
              <a
                href={timeEntriesExportUrl(userId, weekStart, weekEnd)}
                download
                aria-label={t('grid.exportCsv')}
                title={t('grid.exportCsv')}
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {locked ? <p className="text-sm text-fg-muted">{t('grid.lockedNotice')}</p> : null}

      {entriesQuery.isLoading ? (
        <Skeleton className="h-48" />
      ) : itemRows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock aria-hidden="true" />}
          title={t('grid.empty')}
          description={t('grid.emptyDescription')}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-48 px-2 pb-2 text-start font-medium text-fg-muted">
                  {t('grid.item')}
                </th>
                {days.map((date) => (
                  <th key={date} scope="col" className="px-1 pb-2 text-center font-medium text-fg-muted">
                    <span className="block capitalize">{formatDate(date, locale, { style: 'weekday' })}</span>
                    <span className="block text-xs font-normal">
                      {formatDate(date, locale, { style: 'dayMonth' })}
                    </span>
                  </th>
                ))}
                <th scope="col" className="w-16 px-1 pb-2 text-end font-medium text-fg-muted">
                  {t('grid.total')}
                </th>
                <th scope="col" className="w-10" />
              </tr>
            </thead>
            <tbody>
              {itemRows.map((row) => {
                const key = rowKeyOf(row);
                const rowTotal = days.reduce((sum, date) => sum + (entryAt(row, date)?.minutes ?? 0), 0);
                return (
                  <tr key={key} className="border-t border-border">
                    <th scope="row" className="px-2 py-1.5 text-start font-normal">
                      <span className="block truncate" title={itemNames.get(row.itemId) ?? row.itemId}>
                        {itemNames.get(row.itemId) ?? row.itemId}
                      </span>
                    </th>
                    {days.map((date) => (
                      <td key={date} className="px-1 py-1">
                        <HourCell
                          entry={entryAt(row, date)}
                          locked={locked}
                          onCommit={(hours) => {
                            commitCell(row, date, hours);
                          }}
                          label={t('grid.hoursOn', {
                            date: formatDate(date, locale, { style: 'dayMonth' }),
                          })}
                        />
                      </td>
                    ))}
                    <td className="px-1 py-1 text-end tabular-nums">{minutesToHours(rowTotal)}</td>
                    <td className="px-1 py-1 text-center">
                      {locked ? null : (
                        <IconButton
                          label={t('grid.removeRow')}
                          icon={<Trash2 aria-hidden="true" />}
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            removeRow(row);
                          }}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <th scope="row" className="px-2 py-2 text-start">
                  {t('grid.total')}
                </th>
                {days.map((date) => {
                  const dayTotal = itemRows.reduce((sum, row) => sum + (entryAt(row, date)?.minutes ?? 0), 0);
                  return (
                    <td key={date} className="px-1 py-2 text-center tabular-nums">
                      {minutesToHours(dayTotal)}
                    </td>
                  );
                })}
                <td className="px-1 py-2 text-end tabular-nums">{minutesToHours(totalMinutes)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {locked ? null : (
          <ItemSearchPopover
            onPick={(hit) => {
              const itemId = hit.itemId ?? hit.id;
              setExtraRows((current) => [
                ...current.filter((row) => row.itemId !== itemId),
                { boardId: hit.boardId, itemId, itemName: hit.title },
              ]);
            }}
          />
        )}
        {locked ? null : (
          <Button
            loading={submit.isPending}
            disabled={totalMinutes === 0}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {t('grid.submit')}
          </Button>
        )}
      </div>
    </div>
  );
}

function ApprovalBadge({ status }: { status: 'draft' | 'submitted' | 'approved' | 'rejected' }) {
  const t = useTranslations('timesheet');
  const tone =
    status === 'approved'
      ? 'success'
      : status === 'rejected'
        ? 'danger'
        : status === 'submitted'
          ? 'info'
          : 'neutral';
  return <Badge tone={tone}>{t(`status.${status}`)}</Badge>;
}
