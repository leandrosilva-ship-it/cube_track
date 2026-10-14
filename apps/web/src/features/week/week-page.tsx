'use client';

import { formatDate } from '@cube-track/i18n';
import { Badge, Button, EmptyState, IconButton, Skeleton } from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api/client';
import type { Week, WeekItem } from '@/lib/api/types';
import { qk } from '@/lib/query/keys';
import { useAuthenticated } from '@/stores/session';

function shift(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function ItemLink({ item }: { item: WeekItem }) {
  return (
    <Link
      href={`/w/${item.workspaceId}/b/${item.boardId}`}
      className="flex flex-col rounded-md border border-border bg-surface px-3 py-2 text-sm hover:border-primary hover:bg-surface-hover"
    >
      <span className="font-medium">{item.name}</span>
      <span className="text-xs text-fg-muted">
        {item.boardName} · {item.groupName}
      </span>
    </Link>
  );
}

/** Minha semana: itens atribuídos ao usuário com prazo na semana (e atrasados). */
export function WeekPage() {
  const t = useTranslations('week');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [anchor, setAnchor] = useState(today);
  const authenticated = useAuthenticated();
  const week = useQuery({
    queryKey: qk.week(anchor),
    queryFn: () => api<Week>('/v1/me/week', { query: { date: anchor } }),
    enabled: authenticated,
  });
  const data = week.data;
  const days =
    data === undefined ? [] : Array.from({ length: 7 }, (_, index) => shift(data.from, index));
  const overdue = (data?.data ?? []).filter((item) => item.overdue);

  return (
    <div className="pb-10">
      <PageHeader
        title={t('title')}
        subtitle={
          data === undefined
            ? t('subtitle')
            : t('range', {
                from: formatDate(data.from, locale, { style: 'dayMonth' }),
                to: formatDate(data.to, locale, { style: 'dayMonth' }),
              })
        }
        actions={
          <>
            <IconButton
              label={t('previous')}
              icon={<ChevronLeft aria-hidden="true" />}
              variant="secondary"
              onClick={() => {
                setAnchor((value) => shift(value, -7));
              }}
            />
            <Button
              variant="secondary"
              onClick={() => {
                setAnchor(today());
              }}
            >
              {t('current')}
            </Button>
            <IconButton
              label={t('next')}
              icon={<ChevronRight aria-hidden="true" />}
              variant="secondary"
              onClick={() => {
                setAnchor((value) => shift(value, 7));
              }}
            />
          </>
        }
      />
      <div className="flex flex-col gap-6 px-4 sm:px-8">
        {data === undefined ? (
          <Skeleton className="h-48" />
        ) : data.data.length === 0 ? (
          <EmptyState icon={<CalendarCheck aria-hidden="true" />} title={t('empty')} />
        ) : (
          <>
            {overdue.length > 0 ? (
              <section aria-labelledby="week-overdue">
                <h2
                  id="week-overdue"
                  className="mb-2 flex items-center gap-2 text-sm font-semibold text-danger"
                >
                  {t('overdue')} <Badge tone="danger">{overdue.length}</Badge>
                </h2>
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {overdue.map((item) => (
                    <li key={item.id}>
                      <ItemLink item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="grid gap-3 md:grid-cols-7">
              {days.map((day) => {
                const items = data.data.filter((item) => !item.overdue && item.dueDate === day);
                return (
                  <section
                    key={day}
                    aria-labelledby={`day-${day}`}
                    className="rounded-lg bg-surface-sunken p-2"
                  >
                    <h2
                      id={`day-${day}`}
                      className="mb-2 px-1 text-xs font-semibold capitalize text-fg-muted"
                    >
                      {formatDate(day, locale, { style: 'weekday' })}
                      {day === today() ? (
                        <Badge tone="primary" className="ms-1">
                          {tc('today')}
                        </Badge>
                      ) : null}
                    </h2>
                    <ul className="flex flex-col gap-2">
                      {items.map((item) => (
                        <li key={item.id}>
                          <ItemLink item={item} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
