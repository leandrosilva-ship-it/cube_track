'use client';

import { formatDate, formatNumber, type Locale } from '@cube-track/i18n';
import { AvatarGroup, StatusPill } from '@cube-track/ui';
import { Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { BoardColumn, Item, Member } from '@/lib/api/types';

const NATIVE_BY_BINDING: Record<string, keyof Item> = {
  'item.planned_start_date': 'plannedStartDate',
  'item.planned_end_date': 'plannedEndDate',
  'item.replanned_start_date': 'replannedStartDate',
  'item.replanned_end_date': 'replannedEndDate',
  'item.actual_start_date': 'actualStartDate',
  'item.actual_end_date': 'actualEndDate',
  'item.progress': 'progress',
};

/** Colunas que a lista simples exibe (a Tabela completa chega no Prompt 5). */
export const DISPLAYABLE_TYPES = new Set([
  'status',
  'people',
  'date',
  'number',
  'text',
  'checkbox',
  'dropdown',
]);

/** Valor bruto da célula, considerando colunas vinculadas a campos nativos. */
export function cellValue(item: Item, column: BoardColumn): unknown {
  if (column.binding !== null) {
    const native = NATIVE_BY_BINDING[column.binding];
    if (native !== undefined) {
      const value = item[native];
      return value === null ? null : column.type === 'date' ? { d: value } : { n: value };
    }
  }
  return item.values[column.key] ?? null;
}

/** Texto da célula (CSV e rótulos acessíveis). */
export function cellText(
  item: Item,
  column: BoardColumn,
  members: ReadonlyMap<string, Member>,
  locale: Locale,
): string {
  const value = cellValue(item, column) as Record<string, unknown> | null;
  if (value === null || typeof value !== 'object') return '';
  switch (column.type) {
    case 'status':
      return column.labels.find((label) => label.id === value.labelId)?.label ?? '';
    case 'people':
      return (Array.isArray(value.personIds) ? value.personIds : [])
        .map((id) => members.get(String(id))?.name ?? '')
        .filter((name) => name !== '')
        .join(', ');
    case 'date':
      return typeof value.d === 'string' ? formatDate(value.d, locale) : '';
    case 'number':
      return typeof value.n === 'string' || typeof value.n === 'number'
        ? formatNumber(value.n, locale)
        : '';
    case 'text':
      return typeof value.text === 'string' ? value.text : '';
    case 'checkbox':
      return value.checked === true ? '✓' : '';
    case 'dropdown':
      return (Array.isArray(value.optionIds) ? value.optionIds : [])
        .map((id) => column.options.find((option) => option.id === id)?.label ?? '')
        .join(', ');
    default:
      return '';
  }
}

export function Cell({
  item,
  column,
  members,
}: {
  item: Item;
  column: BoardColumn;
  members: ReadonlyMap<string, Member>;
}) {
  const t = useTranslations('board.items');
  const locale = useLocale();
  if (item.redactedFields.includes(column.key)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
        <Lock className="size-3" aria-hidden="true" />
        <span className="sr-only">{t('hiddenValue')}</span>
      </span>
    );
  }
  const value = cellValue(item, column) as Record<string, unknown> | null;
  if (column.type === 'status') {
    const label = column.labels.find((entry) => entry.id === value?.labelId);
    return label === undefined ? (
      <span className="text-fg-subtle">—</span>
    ) : (
      <StatusPill label={label.label} color={label.color} className="min-w-28" />
    );
  }
  if (column.type === 'people') {
    const ids = Array.isArray(value?.personIds) ? value.personIds.map(String) : [];
    if (ids.length === 0) return <span className="text-fg-subtle">—</span>;
    const people = ids.map((id) => ({
      id,
      name: members.get(id)?.name ?? '…',
      avatarUrl: members.get(id)?.avatarUrl ?? null,
    }));
    return (
      <AvatarGroup
        people={people}
        max={3}
        size="xs"
        label={people.map((person) => person.name).join(', ')}
        overflowLabel={(count) => `+${String(count)}`}
      />
    );
  }
  const text = cellText(item, column, members, locale);
  return text === '' ? (
    <span className="text-fg-subtle">—</span>
  ) : (
    <span className="truncate">{text}</span>
  );
}
