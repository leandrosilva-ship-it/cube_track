'use client';

import type { CellTextDirectory, CellTextLocale } from '@cube-track/shared';
import { AvatarGroup, StatusPill, Tooltip, accessiblePair, cn } from '@cube-track/ui';
import {
  AlertTriangle,
  Check,
  Lock,
  MapPin,
  Paperclip,
  Pause,
  Play,
  Star,
  ThumbsUp,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { memo, type ReactNode } from 'react';

import type { BoardColumn, Item } from '@/lib/api/types';

import { useItemName } from './hooks';
import { cellTextOf, cellValue } from './model';

/** Contexto de exibição compartilhado por todas as células visíveis. */
export interface CellContext {
  directory: CellTextDirectory;
  locale: CellTextLocale;
  today: string;
  currentUserId: string;
  /** Itens do board por id (nomes em colunas de relação sem nova consulta). */
  itemNames: ReadonlyMap<string, string>;
  /** Predecessores por item (coluna de dependência). */
  predecessors: ReadonlyMap<string, number>;
  /** Item concluído (status principal "done") — prazos concluídos não ficam "atrasados". */
  isDone: (item: Item) => boolean;
  onTimer: (item: Item, column: BoardColumn, action: 'start' | 'stop') => void;
  onVote: (item: Item, column: BoardColumn) => void;
}

function Empty() {
  return <span className="text-fg-subtle" aria-hidden="true" />;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function list(value: Record<string, unknown> | null, key: string): string[] {
  const entry = value?.[key];
  return Array.isArray(entry) ? entry.map(String) : [];
}

function Chip({ label, color }: { label: string; color: string | null }) {
  const pair = color === null ? null : accessiblePair(color);
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-40 shrink-0 items-center truncate rounded-sm px-1.5 text-xs font-medium',
        pair === null && 'bg-surface-sunken text-fg',
      )}
      style={pair === null ? undefined : { backgroundColor: pair.background, color: pair.text }}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

function RelationChip({ id, known }: { id: string; known: string | undefined }) {
  const name = useItemName(id, known);
  return <Chip label={known ?? name.data ?? '…'} color={null} />;
}

function countryName(code: string, locale: CellTextLocale): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function flagOf(code: string): string {
  return /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(0x1f1a5 + code.charCodeAt(0), 0x1f1a5 + code.charCodeAt(1))
    : '';
}

function ComputedError({ code }: { code: string }) {
  const t = useTranslations('table.cells');
  return (
    <Tooltip content={t('formulaError', { code })}>
      <span className="inline-flex items-center gap-1 font-mono text-xs text-danger">
        <AlertTriangle className="size-3.5" aria-hidden="true" />
        {code}
      </span>
    </Tooltip>
  );
}

/**
 * Célula somente leitura (a edição abre um editor próprio). Memoizada: só re-renderiza quando o
 * item (referência), a coluna ou o contexto mudam — essencial para rolar 50 mil linhas.
 */
export const CellDisplay = memo(function CellDisplay({
  item,
  column,
  context,
}: {
  item: Item;
  column: BoardColumn;
  context: CellContext;
}): ReactNode {
  const t = useTranslations('table.cells');
  if (item.redactedFields.includes(column.key)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-fg-subtle">
        <Lock className="size-3" aria-hidden="true" />
        <span className="sr-only">{t('hidden')}</span>
      </span>
    );
  }
  const value = record(cellValue(item, column));
  const text = () => cellTextOf(item, column, context.directory, context.locale);
  switch (column.type) {
    case 'status': {
      const label = column.labels.find((entry) => entry.id === value?.labelId);
      return label === undefined ? (
        <span className="block h-full w-full rounded-sm bg-surface-sunken" aria-hidden="true" />
      ) : (
        <StatusPill label={label.label} color={label.color} className="h-full w-full min-w-0" />
      );
    }
    case 'dropdown': {
      const ids = list(value, 'optionIds');
      if (ids.length === 0) return <Empty />;
      return (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {ids.map((id) => {
            const option = column.options.find((entry) => entry.id === id);
            return option === undefined ? null : (
              <Chip key={id} label={option.label} color={option.color} />
            );
          })}
        </span>
      );
    }
    case 'tags': {
      const tags = list(value, 'tags');
      if (tags.length === 0) return <Empty />;
      return (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {tags.map((tag) => (
            <Chip key={tag} label={`#${tag}`} color={null} />
          ))}
        </span>
      );
    }
    case 'people': {
      const ids = list(value, 'personIds');
      if (ids.length === 0) return <Empty />;
      const people = ids.map((id) => {
        const person = context.directory.people.find((entry) => entry.id === id);
        return { id, name: person?.name ?? '…', avatarUrl: null };
      });
      return (
        <AvatarGroup
          people={people}
          max={3}
          size="xs"
          label={people.map((person) => person.name).join(', ')}
          overflowLabel={(count) => t('more', { count })}
        />
      );
    }
    case 'board_relation': {
      const ids = list(value, 'itemIds');
      if (ids.length === 0) return <Empty />;
      return (
        <span className="flex min-w-0 gap-1 overflow-hidden">
          {ids.slice(0, 3).map((id) => (
            <RelationChip key={id} id={id} known={context.itemNames.get(id)} />
          ))}
          {ids.length > 3 ? <span className="text-xs text-fg-muted">+{ids.length - 3}</span> : null}
        </span>
      );
    }
    case 'checkbox':
      return value?.checked === true ? (
        <Check className="mx-auto size-4 text-success" aria-label={t('checked')} />
      ) : (
        <span className="sr-only">{t('unchecked')}</span>
      );
    case 'rating': {
      const max = typeof column.settings.max === 'number' ? column.settings.max : 5;
      const n = Number(value?.n ?? 0);
      return (
        <span className="inline-flex" role="img" aria-label={t('rating', { value: n, max })}>
          {Array.from({ length: max }, (_, index) => (
            <Star
              key={index}
              className={cn(
                'size-3.5',
                index < n ? 'fill-warning text-warning' : 'text-border-strong',
              )}
              aria-hidden="true"
            />
          ))}
        </span>
      );
    }
    case 'date': {
      const d = typeof value?.d === 'string' ? value.d : null;
      if (d === null) return <Empty />;
      const overdue = d < context.today && !context.isDone(item);
      return (
        <span className={cn('truncate', overdue && 'font-medium text-danger')}>
          {text()}
          {overdue ? <span className="sr-only"> ({t('overdue')})</span> : null}
        </span>
      );
    }
    case 'progress': {
      const n = Number(value?.n ?? Number.NaN);
      if (Number.isNaN(n)) return <Empty />;
      return (
        <span className="flex w-full items-center gap-2">
          <span
            className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full bg-success"
              style={{ width: `${String(Math.max(0, Math.min(100, n)))}%` }}
            />
          </span>
          <span className="w-10 text-end text-xs tabular-nums">{text()}</span>
        </span>
      );
    }
    case 'formula':
    case 'mirror':
    case 'rollup': {
      if (typeof value?.error === 'string') return <ComputedError code={value.error} />;
      const shown = text();
      return shown === '' ? (
        <Empty />
      ) : (
        <span
          className={cn('truncate', typeof value?.n === 'string' && 'w-full text-end tabular-nums')}
        >
          {shown}
        </span>
      );
    }
    case 'number':
    case 'auto_id': {
      const shown = text();
      return shown === '' ? (
        <Empty />
      ) : (
        <span
          className={cn(
            'truncate tabular-nums',
            column.type === 'number' ? 'w-full text-end' : 'font-mono text-xs',
          )}
        >
          {shown}
        </span>
      );
    }
    case 'time_tracking': {
      const running = typeof value?.runningSince === 'string';
      return (
        <span className="flex w-full items-center gap-1">
          <button
            type="button"
            tabIndex={-1}
            className="inline-flex size-6 items-center justify-center rounded-full bg-surface-sunken hover:bg-surface-hover"
            aria-label={running ? t('timerStop') : t('timerStart')}
            onClick={(event) => {
              event.stopPropagation();
              context.onTimer(item, column, running ? 'stop' : 'start');
            }}
          >
            {running ? (
              <Pause className="size-3.5 text-danger" aria-hidden="true" />
            ) : (
              <Play className="size-3.5" aria-hidden="true" />
            )}
          </button>
          <span className="flex-1 text-end tabular-nums">{text() || '0'}</span>
          {running ? <span className="sr-only">{t('timerRunning')}</span> : null}
        </span>
      );
    }
    case 'vote': {
      const ids = list(value, 'userIds');
      const voted = ids.includes(context.currentUserId);
      return (
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={voted}
          className={cn(
            'mx-auto inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs',
            voted ? 'border-primary bg-primary-soft text-primary' : 'border-border',
          )}
          onClick={(event) => {
            event.stopPropagation();
            context.onVote(item, column);
          }}
        >
          <ThumbsUp className="size-3.5" aria-hidden="true" />
          {ids.length}
          <span className="sr-only">{voted ? t('unvote') : t('vote')}</span>
        </button>
      );
    }
    case 'button': {
      const label =
        typeof column.settings.label === 'string' ? column.settings.label : column.title;
      return (
        <Tooltip content={t('buttonNoAutomation')}>
          <span className="mx-auto inline-flex h-6 items-center rounded-md border border-border px-2 text-xs text-fg-muted">
            {label}
          </span>
        </Tooltip>
      );
    }
    case 'file': {
      const count = list(value, 'attachmentIds').length;
      return count === 0 ? (
        <Empty />
      ) : (
        <span className="inline-flex items-center gap-1 text-xs">
          <Paperclip className="size-3.5" aria-hidden="true" />
          {t('files', { count })}
        </span>
      );
    }
    case 'link': {
      const url = typeof value?.url === 'string' ? value.url : null;
      if (url === null) return <Empty />;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          className="truncate text-primary underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {typeof value?.text === 'string' && value.text !== '' ? value.text : url}
        </a>
      );
    }
    case 'email':
    case 'phone': {
      const raw = column.type === 'email' ? value?.email : value?.phone;
      if (typeof raw !== 'string') return <Empty />;
      return (
        <a
          href={`${column.type === 'email' ? 'mailto' : 'tel'}:${raw}`}
          tabIndex={-1}
          className="truncate text-primary underline-offset-2 hover:underline"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {raw}
        </a>
      );
    }
    case 'color': {
      const color = typeof value?.color === 'string' ? value.color : null;
      if (color === null) return <Empty />;
      return (
        <span className="inline-flex items-center gap-2">
          <span
            className="size-4 rounded-sm border border-border"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="font-mono text-xs">{color}</span>
        </span>
      );
    }
    case 'country': {
      const code = typeof value?.code === 'string' ? value.code : null;
      if (code === null) return <Empty />;
      return (
        <span className="truncate">
          <span aria-hidden="true">{flagOf(code)} </span>
          {countryName(code, context.locale)}
        </span>
      );
    }
    case 'location': {
      const address = typeof value?.address === 'string' ? value.address : null;
      if (address === null) return <Empty />;
      return (
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="truncate">{address}</span>
        </span>
      );
    }
    case 'dependency': {
      const count = context.predecessors.get(item.id) ?? 0;
      return count === 0 ? (
        <Empty />
      ) : (
        <span className="text-xs">{t('predecessors', { count })}</span>
      );
    }
    case 'item_id':
      return <span className="truncate font-mono text-xs text-fg-muted">{item.id.slice(-8)}</span>;
    default: {
      const shown = text();
      return shown === '' ? <Empty /> : <span className="truncate">{shown}</span>;
    }
  }
});
