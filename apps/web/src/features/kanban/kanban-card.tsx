'use client';

import type { CellTextDirectory, CellTextLocale } from '@cube-track/shared';
import { AvatarGroup, Badge, StatusPill, cn } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';

import type { BoardColumn, Item, Member } from '@/lib/api/types';

import type { SlaBadge } from '../processes/model';
import { cellTextOf, cellValue } from '../table/model';

const SLA_BADGE_TONE = { ok: 'success', warning: 'warning', breached: 'danger' } as const;

function SlaIndicator({ badge }: { badge: SlaBadge }) {
  const t = useTranslations('processes');
  return <Badge tone={SLA_BADGE_TONE[badge.variant]}>{t(badge.message.key, badge.message.values)}</Badge>;
}

function personIdsOf(value: unknown): string[] {
  const record = value as { personIds?: unknown } | null;
  return Array.isArray(record?.personIds) ? record.personIds.map(String) : [];
}

function tagsOf(value: unknown): string[] {
  const record = value as { tags?: unknown } | null;
  return Array.isArray(record?.tags) ? record.tags.map(String) : [];
}

function CardField({
  item,
  column,
  members,
  directory,
  locale,
}: {
  item: Item;
  column: BoardColumn;
  members: readonly Member[];
  directory: CellTextDirectory;
  locale: CellTextLocale;
}) {
  if (item.redactedFields.includes(column.key)) return null;
  const value = cellValue(item, column) as Record<string, unknown> | null;
  if (column.type === 'status') {
    const label = column.labels.find((entry) => entry.id === value?.labelId);
    return label === undefined ? null : <StatusPill label={label.label} color={label.color} />;
  }
  if (column.type === 'dropdown') {
    const optionIds = Array.isArray(value?.optionIds) ? value.optionIds.map(String) : [];
    const options = column.options.filter((option) => optionIds.includes(option.id));
    if (options.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <StatusPill key={option.id} label={option.label} color={option.color ?? '#c4c4c4'} />
        ))}
      </div>
    );
  }
  if (column.type === 'people') {
    const ids = personIdsOf(value);
    if (ids.length === 0) return null;
    const people = ids.map((id) => {
      const member = members.find((entry) => entry.userId === id);
      return { id, name: member?.name ?? id, avatarUrl: member?.avatarUrl ?? null };
    });
    return (
      <AvatarGroup
        people={people}
        size="xs"
        label={column.title}
        overflowLabel={(count) => `+${String(count)}`}
      />
    );
  }
  if (column.type === 'tags') {
    const tags = tagsOf(value);
    if (tags.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
    );
  }
  const text = cellTextOf(item, column, directory, locale);
  return text === '' ? null : <span className="text-xs text-fg-muted">{text}</span>;
}

export interface KanbanCardProps extends HTMLAttributes<HTMLDivElement> {
  item: Item;
  fields: readonly BoardColumn[];
  density: 'compact' | 'detailed';
  members: readonly Member[];
  directory: CellTextDirectory;
  locale: CellTextLocale;
  selected: boolean;
  dragging?: boolean;
  style?: CSSProperties;
  /** Indicador de SLA (fase/processo, ADR 0051) do tracker mais urgente deste item. */
  slaBadge?: SlaBadge | null;
}

/** Cartão do Kanban: nome e os campos escolhidos na configuração da view. */
export const KanbanCard = forwardRef<HTMLDivElement, KanbanCardProps>(function KanbanCard(
  {
    item,
    fields,
    density,
    members,
    directory,
    locale,
    selected,
    dragging,
    className,
    style,
    slaBadge,
    ...props
  },
  ref,
) {
  const t = useTranslations('kanban.card');
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={item.name}
      style={style}
      className={cn(
        'flex flex-col gap-1.5 rounded-md border bg-surface-raised p-2.5 text-start text-sm shadow-sm outline-none',
        'hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
        dragging === true && 'opacity-50',
        density === 'compact' && 'py-1.5',
        className,
      )}
      {...props}
    >
      <p className="line-clamp-3 font-medium text-fg">{item.name}</p>
      {density === 'detailed' && fields.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {fields.map((column) => (
            <CardField
              key={column.key}
              item={item}
              column={column}
              members={members}
              directory={directory}
              locale={locale}
            />
          ))}
        </div>
      ) : null}
      {(item.indicators !== undefined &&
        (item.indicators.subitems > 0 || item.indicators.attachments > 0)) ||
      (slaBadge ?? null) !== null ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          {item.indicators !== undefined && item.indicators.subitems > 0 ? (
            <span>{t('subitems', { count: item.indicators.subitems })}</span>
          ) : null}
          {item.indicators !== undefined && item.indicators.attachments > 0 ? (
            <span>{t('attachments', { count: item.indicators.attachments })}</span>
          ) : null}
          {slaBadge !== null && slaBadge !== undefined ? <SlaIndicator badge={slaBadge} /> : null}
        </p>
      ) : null}
    </div>
  );
});
