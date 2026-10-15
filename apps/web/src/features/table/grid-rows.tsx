'use client';

import { formatDecimalText, type CellTextLocale } from '@cube-track/shared';
import { Checkbox, Input, cn } from '@cube-track/ui';
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { memo, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import type { Item } from '@/lib/api/types';
import { useCellHighlight } from '@/realtime/highlight';

import { CellDisplay, type CellContext } from './cells';
import { columnAggregate, type GridColumn, type TableRow } from './model';

export const SELECT_COLUMN_WIDTH = 44;
export const ADD_COLUMN_WIDTH = 48;

/** Colunas renderizadas numa linha: fixadas (sticky) + janela virtual das roláveis. */
export interface RowLayout {
  columns: readonly GridColumn[];
  pinnedCount: number;
  pinnedWidth: number;
  totalWidth: number;
  /** Colunas roláveis visíveis: índice em `columns` e deslocamento à esquerda. */
  visible: readonly { index: number; start: number }[];
  /** Muda quando a janela de colunas muda (para memoização das linhas). */
  key: string;
}

export function cellDomId(rowId: string, col: number): string {
  return `ct-cell-${rowId}-${String(col)}`;
}

function pinnedOffsets(layout: RowLayout): number[] {
  const offsets: number[] = [];
  let left = SELECT_COLUMN_WIDTH;
  for (let index = 0; index < layout.pinnedCount; index += 1) {
    offsets.push(left);
    left += layout.columns[index]?.width ?? 0;
  }
  return offsets;
}

function HighlightRing({ itemId, field }: { itemId: string; field: string }) {
  const highlighted = useCellHighlight(itemId, field);
  return highlighted ? (
    <span
      className="ct-remote-highlight pointer-events-none absolute inset-0 rounded-[2px] ring-2 ring-inset ring-warning"
      aria-hidden="true"
    />
  ) : null;
}

// ----------------------------------------------------------------------------- linha de item ---

export interface ItemRowProps {
  row: Extract<TableRow, { kind: 'item' }>;
  rowIndex: number;
  layout: RowLayout;
  context: CellContext;
  selected: boolean;
  /** Coluna ativa nesta linha (ou null). */
  activeCol: number | null;
  /** Colunas da seleção retangular nesta linha. */
  range: readonly [number, number] | null;
  /** Coluna em edição nesta linha (o editor é passado pronto). */
  editingCol: number | null;
  editor: ReactNode;
  expanded: boolean;
  canExpand: boolean;
  onSelect: (item: Item, extend: boolean) => void;
  onToggleExpand: (item: Item) => void;
  onOpenMenu: (item: Item, anchor: { x: number; y: number }) => void;
  style: CSSProperties;
}

function NameCell({
  row,
  expanded,
  canExpand,
  onToggleExpand,
  onOpenMenu,
}: Pick<ItemRowProps, 'row' | 'expanded' | 'canExpand' | 'onToggleExpand' | 'onOpenMenu'>) {
  const t = useTranslations('table.rows');
  const { item } = row;
  const indicators = item.indicators;
  const pending = item.version === 0;
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-1', row.depth === 1 && 'ps-6')}>
      {row.depth === 1 ? (
        <CornerDownRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
      ) : canExpand ? (
        <button
          type="button"
          tabIndex={-1}
          aria-expanded={expanded}
          aria-label={expanded ? t('collapseSubitems') : t('expandSubitems')}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpand(item);
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          {expanded ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
        </button>
      ) : (
        <span className="w-5 shrink-0" aria-hidden="true" />
      )}
      <span className={cn('min-w-0 flex-1 truncate', pending && 'text-fg-muted')}>{item.name}</span>
      {indicators !== undefined && indicators.subitems > 0 && row.depth === 0 ? (
        <span
          className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-[11px] text-fg-muted"
          title={t('subitems', { count: indicators.subitems })}
        >
          <span aria-hidden="true">{indicators.subitems}</span>
          <span className="sr-only">{t('subitems', { count: indicators.subitems })}</span>
        </span>
      ) : null}
      {indicators !== undefined && indicators.attachments > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-fg-muted">
          <Paperclip className="size-3" aria-hidden="true" />
          <span aria-hidden="true">{indicators.attachments}</span>
          <span className="sr-only">{t('attachments', { count: indicators.attachments })}</span>
        </span>
      ) : null}
      {indicators !== undefined && indicators.updates > 0 ? (
        <span className="relative inline-flex shrink-0 items-center gap-0.5 text-[11px] text-fg-muted">
          <MessageSquare
            className={cn('size-3.5', indicators.unreadUpdates > 0 && 'text-primary')}
            aria-hidden="true"
          />
          <span aria-hidden="true">{indicators.updates}</span>
          {indicators.unreadUpdates > 0 ? (
            <span
              className="absolute -end-1 -top-1 size-2 rounded-full bg-danger"
              aria-hidden="true"
            />
          ) : null}
          <span className="sr-only">
            {t('updates', { count: indicators.updates })}
            {indicators.unreadUpdates > 0
              ? `, ${t('unread', { count: indicators.unreadUpdates })}`
              : ''}
          </span>
        </span>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('menu', { name: item.name })}
        className="invisible inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-hover group-hover/row:visible"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu(item, { x: rect.left, y: rect.bottom });
        }}
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}

function GridCell({
  row,
  rowIndex,
  col,
  column,
  context,
  active,
  inRange,
  editing,
  editor,
  style,
  nameCell,
}: {
  row: Extract<TableRow, { kind: 'item' }>;
  rowIndex: number;
  col: number;
  column: GridColumn;
  context: CellContext;
  active: boolean;
  inRange: boolean;
  editing: boolean;
  editor: ReactNode;
  style: CSSProperties;
  nameCell: ReactNode;
}) {
  const fullBleed = column.column?.type === 'status';
  return (
    <div
      id={cellDomId(row.id, col)}
      role="gridcell"
      aria-colindex={col + 2}
      aria-selected={active || inRange}
      aria-readonly={!column.editable}
      data-row={rowIndex}
      data-col={col}
      className={cn(
        'absolute top-0 flex h-full items-center border-e border-b border-border text-sm [contain:layout_style]',
        fullBleed ? 'p-0.5' : 'px-2',
        column.column?.type === 'checkbox' ||
          column.column?.type === 'vote' ||
          column.column?.type === 'button'
          ? 'justify-center'
          : '',
        inRange && !active && 'bg-primary-soft',
        active && 'z-[1] outline outline-2 -outline-offset-2 outline-primary',
      )}
      style={style}
    >
      {column.column === null ? (
        nameCell
      ) : (
        <CellDisplay item={row.item} column={column.column} context={context} />
      )}
      <HighlightRing itemId={row.item.id} field={column.key} />
      {editing ? editor : null}
    </div>
  );
}

export const ItemRow = memo(
  function ItemRow(props: ItemRowProps) {
    const {
      row,
      rowIndex,
      layout,
      context,
      selected,
      activeCol,
      range,
      editingCol,
      editor,
      style,
    } = props;
    const offsets = pinnedOffsets(layout);
    const t = useTranslations('table.rows');
    const nameCell = (
      <NameCell
        row={row}
        expanded={props.expanded}
        canExpand={props.canExpand}
        onToggleExpand={props.onToggleExpand}
        onOpenMenu={props.onOpenMenu}
      />
    );
    const renderCell = (col: number, cellStyle: CSSProperties) => {
      const column = layout.columns[col];
      if (column === undefined) return null;
      return (
        <GridCell
          key={column.key}
          row={row}
          rowIndex={rowIndex}
          col={col}
          column={column}
          context={context}
          active={activeCol === col}
          inRange={range !== null && col >= range[0] && col <= range[1]}
          editing={editingCol === col}
          editor={editor}
          style={cellStyle}
          nameCell={nameCell}
        />
      );
    };
    return (
      // Menu de contexto também abre pelo teclado (tecla Menu/Shift+F10 na grade).
      // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- foco gerenciado pela grade (aria-activedescendant)
      <div
        role="row"
        aria-rowindex={rowIndex + 2}
        aria-selected={selected}
        className={cn(
          'group/row absolute start-0 bg-surface [contain:size_layout_style]',
          selected && 'bg-primary-soft',
        )}
        style={{ ...style, width: layout.totalWidth }}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onOpenMenu(row.item, { x: event.clientX, y: event.clientY });
        }}
      >
        <div
          className={cn(
            'sticky start-0 z-[2] flex h-full',
            selected ? 'bg-primary-soft' : 'bg-surface group-hover/row:bg-surface-hover',
          )}
          style={{ width: layout.pinnedWidth }}
        >
          <div
            role="gridcell"
            aria-colindex={1}
            className="relative flex h-full items-center justify-center border-e border-b border-border"
            style={{ width: SELECT_COLUMN_WIDTH }}
          >
            <span
              className="absolute inset-y-0 start-0 w-1"
              style={{ backgroundColor: row.color }}
              aria-hidden="true"
            />
            {/* Checkbox nativo: dezenas montam por quadro ao rolar rápido. */}
            <input
              type="checkbox"
              tabIndex={-1}
              checked={selected}
              aria-label={t('select', { name: row.item.name })}
              className="size-4 cursor-pointer accent-[var(--ct-primary)]"
              onChange={() => undefined}
              onClick={(event) => {
                event.stopPropagation();
                props.onSelect(row.item, event.shiftKey);
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
              }}
            />
          </div>
          {Array.from({ length: layout.pinnedCount }, (_, col) =>
            renderCell(col, {
              left: offsets[col] ?? 0,
              width: layout.columns[col]?.width ?? 0,
            }),
          )}
        </div>
        {layout.visible.map(({ index, start }) =>
          renderCell(index, { left: start, width: layout.columns[index]?.width ?? 0 }),
        )}
      </div>
    );
  },
  (previous, next) =>
    previous.row.item === next.row.item &&
    previous.row.color === next.row.color &&
    previous.row.depth === next.row.depth &&
    previous.rowIndex === next.rowIndex &&
    previous.layout.key === next.layout.key &&
    previous.context === next.context &&
    previous.selected === next.selected &&
    previous.activeCol === next.activeCol &&
    previous.range?.[0] === next.range?.[0] &&
    previous.range?.[1] === next.range?.[1] &&
    previous.editingCol === next.editingCol &&
    previous.editor === next.editor &&
    previous.expanded === next.expanded &&
    previous.canExpand === next.canExpand &&
    previous.style.transform === next.style.transform &&
    previous.style.height === next.style.height,
);

// -------------------------------------------------------------------- cabeçalho de grupo ---

export interface GroupHeaderRowProps {
  row: Extract<TableRow, { kind: 'header' }>;
  rowIndex: number;
  layout: RowLayout;
  viewportWidth: number;
  canRename: boolean;
  allSelected: boolean;
  onToggle: (path: string) => void;
  onRename: (groupId: string, name: string) => void;
  onSelectAll: (items: readonly Item[], selected: boolean) => void;
  menu: ReactNode;
  style: CSSProperties;
}

export const GroupHeaderRow = memo(
  function GroupHeaderRow({
    row,
    rowIndex,
    layout,
    viewportWidth,
    canRename,
    allSelected,
    onToggle,
    onRename,
    onSelectAll,
    menu,
    style,
  }: GroupHeaderRowProps) {
    const t = useTranslations('table.groups');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(row.bucket.label);
    const groupId = row.bucket.groupId;
    const commit = () => {
      setEditing(false);
      const name = draft.trim();
      if (groupId !== null && name !== '' && name !== row.bucket.label) onRename(groupId, name);
    };
    return (
      <div
        role="row"
        aria-rowindex={rowIndex + 2}
        className="absolute start-0 bg-background"
        style={{ ...style, width: layout.totalWidth }}
      >
        <div
          role="rowheader"
          aria-colspan={layout.columns.length + 1}
          className="sticky start-0 flex h-full items-end gap-2 pb-1.5"
          style={{
            width: Math.min(viewportWidth, layout.totalWidth),
            paddingInlineStart: 8 + row.level * 20,
          }}
        >
          <button
            type="button"
            aria-expanded={!row.collapsed}
            aria-label={
              row.collapsed
                ? t('expand', { name: row.bucket.label })
                : t('collapse', { name: row.bucket.label })
            }
            className="inline-flex size-6 items-center justify-center rounded-sm hover:bg-surface-hover"
            style={{ color: row.color }}
            onClick={() => {
              onToggle(row.path);
            }}
          >
            {row.collapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" aria-hidden="true" />
            )}
          </button>
          <Checkbox
            checked={allSelected && row.bucket.items.length > 0}
            disabled={row.bucket.items.length === 0}
            aria-label={t('selectAll', { name: row.bucket.label })}
            onCheckedChange={(next) => {
              onSelectAll(row.bucket.items, next === true);
            }}
          />
          {editing ? (
            <Input
              value={draft}
              maxLength={200}
              aria-label={t('rename')}
              className="h-7 w-64 text-base font-semibold"
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit();
                if (event.key === 'Escape') {
                  setDraft(row.bucket.label);
                  setEditing(false);
                }
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
              autoFocus
            />
          ) : (
            <h2 className="flex min-w-0 items-center gap-2 truncate text-base font-semibold">
              <span
                className="h-4 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden="true"
              />
              {canRename && groupId !== null ? (
                <button
                  type="button"
                  className="rounded-sm hover:underline"
                  title={t('rename')}
                  onClick={() => {
                    setDraft(row.bucket.label);
                    setEditing(true);
                  }}
                >
                  {row.bucket.label}
                </button>
              ) : (
                row.bucket.label
              )}
            </h2>
          )}
          <span className="shrink-0 text-xs text-fg-muted">
            {t('count', { count: row.bucket.items.length })}
          </span>
          {menu}
        </div>
      </div>
    );
  },
  (previous, next) =>
    previous.row === next.row &&
    previous.rowIndex === next.rowIndex &&
    previous.layout.key === next.layout.key &&
    previous.layout.totalWidth === next.layout.totalWidth &&
    previous.viewportWidth === next.viewportWidth &&
    previous.canRename === next.canRename &&
    previous.allSelected === next.allSelected &&
    previous.style.transform === next.style.transform &&
    previous.style.height === next.style.height,
);

// ------------------------------------------------------------------------- adicionar item ---

export function AddRow({
  row,
  rowIndex,
  layout,
  viewportWidth,
  onCreate,
  style,
}: {
  row: Extract<TableRow, { kind: 'add' }>;
  rowIndex: number;
  layout: RowLayout;
  viewportWidth: number;
  onCreate: (input: { groupId: string; name: string; parentItemId: string | null }) => void;
  style: CSSProperties;
}) {
  const t = useTranslations('table.rows');
  const [name, setName] = useState('');
  const label = row.parentItemId === null ? t('addItem') : t('addSubitem', { name: row.label });
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      className="absolute start-0"
      style={{ ...style, width: layout.totalWidth }}
    >
      <div
        role="gridcell"
        aria-colspan={layout.columns.length + 1}
        className="sticky start-0 h-full"
        style={{ width: Math.min(viewportWidth, layout.pinnedWidth + 240) }}
      >
        <form
          className="flex h-full items-center gap-2 border-b border-border bg-surface"
          style={{ paddingInlineStart: SELECT_COLUMN_WIDTH + (row.depth === 1 ? 36 : 12) }}
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed === '') return;
            onCreate({
              groupId: row.groupId,
              name: trimmed.slice(0, 500),
              parentItemId: row.parentItemId,
            });
            setName('');
          }}
        >
          <span
            className="absolute inset-y-0 start-0 w-1 opacity-50"
            style={{ backgroundColor: row.color }}
            aria-hidden="true"
          />
          <Plus className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') setName('');
            }}
            placeholder={label}
            aria-label={label}
            className="h-7 border-transparent bg-transparent hover:border-border focus:border-border"
          />
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- rodapé ---

function formatAggregate(value: string, column: GridColumn, locale: CellTextLocale): string {
  const settings = column.column?.settings ?? {};
  const decimals = typeof settings.decimals === 'number' ? settings.decimals : 2;
  const text = formatDecimalText(value, locale, decimals, true);
  const unit = typeof settings.unit === 'string' ? settings.unit : '';
  if (unit === '') return column.column?.type === 'progress' ? `${text}%` : text;
  return settings.unitPosition === 'prefix' ? `${unit} ${text}` : `${text} ${unit}`;
}

function FooterCell({
  column,
  items,
  locale,
}: {
  column: GridColumn;
  items: readonly Item[];
  locale: CellTextLocale;
}) {
  const t = useTranslations('table.footer');
  const aggregate = useMemo(
    () => (column.column === null ? null : columnAggregate(column.column, items)),
    [column.column, items],
  );
  if (aggregate === null || aggregate.kind === 'none') return null;
  if (aggregate.kind === 'distribution') {
    if (aggregate.total === 0) return null;
    const summary = aggregate.segments
      .map(
        (segment) =>
          `${segment.label === '' ? t('empty') : segment.label}: ${String(segment.count)}`,
      )
      .join(', ');
    return (
      <span
        className="flex h-5 w-full overflow-hidden rounded-sm"
        role="img"
        aria-label={t('distribution', { summary })}
        title={summary}
      >
        {aggregate.segments.map((segment) => (
          <span
            key={segment.key}
            className="h-full"
            style={{
              backgroundColor: segment.color,
              width: `${String((segment.count / aggregate.total) * 100)}%`,
            }}
          />
        ))}
      </span>
    );
  }
  if (aggregate.kind === 'count')
    return (
      <span className="w-full text-center text-xs text-fg-muted">
        {t('filled', { filled: aggregate.filled, total: aggregate.total })}
      </span>
    );
  return (
    <span className="flex w-full flex-col items-end leading-tight">
      <span className="text-sm font-semibold tabular-nums">
        {aggregate.value === null
          ? '—'
          : aggregate.aggregate === 'count'
            ? aggregate.value
            : formatAggregate(aggregate.value, column, locale)}
      </span>
      <span className="text-[10px] uppercase text-fg-subtle">
        {t(`aggregates.${aggregate.aggregate}`)}
      </span>
    </span>
  );
}

export const FooterRow = memo(function FooterRow({
  row,
  rowIndex,
  layout,
  locale,
  style,
}: {
  row: Extract<TableRow, { kind: 'footer' }>;
  rowIndex: number;
  layout: RowLayout;
  locale: CellTextLocale;
  style: CSSProperties;
}) {
  const t = useTranslations('table.footer');
  const offsets = pinnedOffsets(layout);
  const cell = (col: number, cellStyle: CSSProperties) => {
    const column = layout.columns[col];
    if (column === undefined) return null;
    return (
      <div
        key={column.key}
        role="gridcell"
        aria-colindex={col + 2}
        className="absolute top-0 flex h-full items-center px-2"
        style={cellStyle}
      >
        {column.column === null ? (
          <span className="text-xs text-fg-muted">{t('items', { count: row.items.length })}</span>
        ) : (
          <FooterCell column={column} items={row.items} locale={locale} />
        )}
      </div>
    );
  };
  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 2}
      className="absolute start-0"
      style={{ ...style, width: layout.totalWidth }}
    >
      <div
        className="sticky start-0 z-[2] h-full bg-background"
        style={{ width: layout.pinnedWidth }}
      >
        {Array.from({ length: layout.pinnedCount }, (_, col) =>
          cell(col, { left: offsets[col] ?? 0, width: layout.columns[col]?.width ?? 0 }),
        )}
      </div>
      {layout.visible.map(({ index, start }) =>
        cell(index, { left: start, width: layout.columns[index]?.width ?? 0 }),
      )}
    </div>
  );
});
