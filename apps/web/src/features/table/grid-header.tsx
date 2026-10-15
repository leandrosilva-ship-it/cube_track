'use client';

import { parseSort, type SortTerm } from '@cube-track/shared';
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  cn,
} from '@cube-track/ui';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  EyeOff,
  Info,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Star,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, clampWidth, type GridColumn } from './model';
import { ADD_COLUMN_WIDTH, SELECT_COLUMN_WIDTH, type RowLayout } from './grid-rows';

export const HEADER_HEIGHT = 40;

/** Tipos que o servidor sabe ordenar (projeção tipada, status e checkbox). */
export const SORTABLE_TYPES = new Set([
  'text',
  'long_text',
  'number',
  'status',
  'date',
  'timeline',
  'week',
  'checkbox',
  'rating',
  'link',
  'email',
  'phone',
  'auto_id',
  'mirror',
  'formula',
  'progress',
  'rollup',
  'time_tracking',
  'country',
  'color',
  'hour',
]);

export function isSortable(column: GridColumn): boolean {
  return column.column === null || SORTABLE_TYPES.has(column.column.type);
}

export function sortTerms(sort: string | undefined): SortTerm[] {
  try {
    return parseSort(sort);
  } catch {
    return [];
  }
}

/** Alterna a ordenação de um campo; com `add` mantém os demais termos (até 3). */
export function toggleSort(
  sort: string | undefined,
  field: string,
  add: boolean,
): string | undefined {
  const terms = sortTerms(sort);
  const existing = terms.find((term) => term.field === field);
  const others = terms.filter((term) => term.field !== field);
  let next: SortTerm[];
  if (existing === undefined) next = [...(add ? others : []), { field, direction: 'asc' }];
  else if (existing.direction === 'asc')
    next = add
      ? terms.map((term) => (term.field === field ? { field, direction: 'desc' } : term))
      : [{ field, direction: 'desc' }];
  else next = add ? others : [];
  const trimmed = next.slice(-3);
  return trimmed.length === 0
    ? undefined
    : trimmed.map((term) => `${term.field}:${term.direction}`).join(',');
}

export interface HeaderActions {
  canManageColumns: boolean;
  onSort: (field: string, add: boolean) => void;
  onSortDirection: (field: string, direction: 'asc' | 'desc') => void;
  onResize: (key: string, width: number, done: boolean) => void;
  onReorder: (key: string, beforeKey: string | null) => void;
  onPin: (key: string, pinned: boolean) => void;
  onHide: (key: string) => void;
  onConfigure: (key: string) => void;
  onDuplicate: (key: string, includeValues: boolean) => void;
  onDelete: (key: string) => void;
  onSetMainStatus: (key: string) => void;
  onAddColumn: () => void;
}

function HeaderCell({
  column,
  index,
  columns,
  mainStatusKey,
  terms,
  actions,
  style,
}: {
  column: GridColumn;
  index: number;
  columns: readonly GridColumn[];
  mainStatusKey: string | null;
  terms: readonly SortTerm[];
  actions: HeaderActions;
  style: CSSProperties;
}) {
  const t = useTranslations('table.header');
  const [dragOver, setDragOver] = useState(false);
  const startRef = useRef<{ x: number; width: number } | null>(null);
  const term = terms.find((entry) => entry.field === column.key);
  const termIndex = term === undefined ? -1 : terms.indexOf(term);
  const sortable = isSortable(column);
  const board = column.column;
  const isName = board === null;
  const required = board !== null && (board.isRequired || board.requiredWhen !== null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, width: column.width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (startRef.current === null) return;
    actions.onResize(
      column.key,
      clampWidth(startRef.current.width + event.clientX - startRef.current.x),
      false,
    );
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (startRef.current === null) return;
    const width = clampWidth(startRef.current.width + event.clientX - startRef.current.x);
    startRef.current = null;
    actions.onResize(column.key, width, true);
  };
  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      actions.onResize(
        column.key,
        clampWidth(column.width + (event.key === 'ArrowLeft' ? -step : step)),
        true,
      );
    }
  };
  const neighbor = (delta: -1 | 1) => columns[index + delta];

  return (
    // Arrastar o cabeçalho reordena; pelo teclado, o menu da coluna tem "mover para a esquerda/direita".
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- ver acima
    <div
      role="columnheader"
      aria-colindex={index + 2}
      aria-sort={
        term === undefined ? 'none' : term.direction === 'asc' ? 'ascending' : 'descending'
      }
      className={cn(
        'group/header absolute top-0 flex h-full items-center gap-1 border-e border-b border-border bg-surface ps-2 text-xs font-semibold text-fg-muted',
        dragOver && 'bg-primary-soft',
      )}
      style={style}
      draggable={!isName && !column.pinned}
      onDragStart={(event) => {
        event.dataTransfer.setData('application/x-cube-column', column.key);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (isName || !event.dataTransfer.types.includes('application/x-cube-column')) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => {
        setDragOver(false);
      }}
      onDrop={(event) => {
        setDragOver(false);
        const key = event.dataTransfer.getData('application/x-cube-column');
        if (key !== '' && key !== column.key) actions.onReorder(key, column.key);
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={!sortable}
        className="flex min-w-0 flex-1 items-center gap-1 text-start disabled:cursor-default"
        title={sortable ? t('sortHint') : undefined}
        onClick={(event) => {
          if (sortable) actions.onSort(column.key, event.shiftKey);
        }}
      >
        <span className="truncate">{column.title}</span>
        {required ? (
          <span className="text-danger" aria-label={t('required')}>
            *
          </span>
        ) : null}
        {board?.key === mainStatusKey ? (
          <Star
            className="size-3 shrink-0 fill-warning text-warning"
            aria-label={t('mainStatus')}
          />
        ) : null}
        {term === undefined ? null : (
          <span className="inline-flex shrink-0 items-center text-primary">
            {term.direction === 'asc' ? (
              <ArrowUp className="size-3.5" aria-hidden="true" />
            ) : (
              <ArrowDown className="size-3.5" aria-hidden="true" />
            )}
            {terms.length > 1 ? <span className="text-[10px]">{termIndex + 1}</span> : null}
          </span>
        )}
      </button>
      {board?.description !== null &&
      board?.description !== undefined &&
      board.description !== '' ? (
        <Tooltip content={board.description}>
          <span className="inline-flex shrink-0" tabIndex={-1}>
            <Info className="size-3.5" aria-label={board.description} />
          </span>
        </Tooltip>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm opacity-0 hover:bg-surface-hover focus-visible:opacity-100 group-hover/header:opacity-100 data-[state=open]:opacity-100"
            aria-label={t('menu', { name: column.title })}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {sortable ? (
            <>
              <DropdownMenuItem
                icon={<ArrowUp aria-hidden="true" />}
                onSelect={() => {
                  actions.onSortDirection(column.key, 'asc');
                }}
              >
                {t('sortAsc')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<ArrowDown aria-hidden="true" />}
                onSelect={() => {
                  actions.onSortDirection(column.key, 'desc');
                }}
              >
                {t('sortDesc')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {!isName ? (
            <>
              <DropdownMenuItem
                icon={column.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                onSelect={() => {
                  actions.onPin(column.key, !column.pinned);
                }}
              >
                {column.pinned ? t('unpin') : t('pin')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<EyeOff aria-hidden="true" />}
                onSelect={() => {
                  actions.onHide(column.key);
                }}
              >
                {t('hide')}
              </DropdownMenuItem>
              {!column.pinned && neighbor(-1)?.pinned === false ? (
                <DropdownMenuItem
                  icon={<ArrowLeft aria-hidden="true" />}
                  onSelect={() => {
                    actions.onReorder(column.key, neighbor(-1)?.key ?? null);
                  }}
                >
                  {t('moveLeft')}
                </DropdownMenuItem>
              ) : null}
              {!column.pinned && neighbor(1) !== undefined ? (
                <DropdownMenuItem
                  icon={<ArrowRight aria-hidden="true" />}
                  onSelect={() => {
                    actions.onReorder(column.key, columns[index + 2]?.key ?? null);
                  }}
                >
                  {t('moveRight')}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {!isName && actions.canManageColumns ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                icon={<Settings2 aria-hidden="true" />}
                onSelect={() => {
                  actions.onConfigure(column.key);
                }}
              >
                {t('configure')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Copy aria-hidden="true" />}
                onSelect={() => {
                  actions.onDuplicate(column.key, true);
                }}
              >
                {t('duplicateWithValues')}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Copy aria-hidden="true" />}
                onSelect={() => {
                  actions.onDuplicate(column.key, false);
                }}
              >
                {t('duplicateStructure')}
              </DropdownMenuItem>
              {board.type === 'status' && board.key !== mainStatusKey ? (
                <DropdownMenuItem
                  icon={<Star aria-hidden="true" />}
                  onSelect={() => {
                    actions.onSetMainStatus(column.key);
                  }}
                >
                  {t('setMainStatus')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                icon={<Trash2 aria-hidden="true" />}
                onSelect={() => {
                  actions.onDelete(column.key);
                }}
              >
                {t('delete')}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Separador focável (padrão "window splitter" da WAI-ARIA): setas redimensionam. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions -- separador focável */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resize', { name: column.title })}
        aria-valuenow={column.width}
        aria-valuemin={MIN_COLUMN_WIDTH}
        aria-valuemax={MAX_COLUMN_WIDTH}
        tabIndex={0}
        className="absolute inset-y-0 -end-1 z-[3] w-2 cursor-col-resize touch-none hover:bg-primary/40 focus-visible:bg-primary/60"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onResizeKey}
        onDoubleClick={() => {
          actions.onResize(column.key, isName ? 320 : 160, true);
        }}
      />
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions */}
    </div>
  );
}

/** Linha de cabeçalho fixa no topo (sticky) com o mesmo layout virtual das linhas. */
export function GridHeader({
  layout,
  sort,
  mainStatusKey,
  actions,
  allSelected,
  someSelected,
  onSelectAll,
}: {
  layout: RowLayout;
  sort: string | undefined;
  mainStatusKey: string | null;
  actions: HeaderActions;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: (selected: boolean) => void;
}) {
  const t = useTranslations('table.header');
  const terms = sortTerms(sort);
  const pinnedColumns = layout.columns.slice(0, layout.pinnedCount);
  const pinned = pinnedColumns.map((column, index) => {
    const left =
      SELECT_COLUMN_WIDTH +
      pinnedColumns.slice(0, index).reduce((sum, entry) => sum + entry.width, 0);
    const style = { left, width: column.width };
    return (
      <HeaderCell
        key={column.key}
        column={column}
        index={index}
        columns={layout.columns}
        mainStatusKey={mainStatusKey}
        terms={terms}
        actions={actions}
        style={style}
      />
    );
  });
  return (
    <div
      role="rowgroup"
      className="sticky top-0 z-[4]"
      style={{ height: HEADER_HEIGHT, width: layout.totalWidth }}
    >
      <div role="row" aria-rowindex={1} className="relative h-full bg-surface">
        <div
          className="sticky start-0 z-[2] h-full bg-surface"
          style={{ width: layout.pinnedWidth }}
        >
          <div
            role="columnheader"
            aria-colindex={1}
            className="absolute inset-y-0 start-0 flex items-center justify-center border-e border-b border-border"
            style={{ width: SELECT_COLUMN_WIDTH }}
          >
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              aria-label={t('selectAll')}
              onCheckedChange={(next) => {
                onSelectAll(next === true);
              }}
            />
          </div>
          {pinned}
        </div>
        {layout.visible.map(({ index, start }) => {
          const column = layout.columns[index];
          return column === undefined ? null : (
            <HeaderCell
              key={column.key}
              column={column}
              index={index}
              columns={layout.columns}
              mainStatusKey={mainStatusKey}
              terms={terms}
              actions={actions}
              style={{ left: start, width: column.width }}
            />
          );
        })}
        {actions.canManageColumns ? (
          <div
            className="absolute top-0 flex h-full items-center justify-center border-b border-border"
            style={{ left: layout.totalWidth - ADD_COLUMN_WIDTH, width: ADD_COLUMN_WIDTH }}
          >
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover"
              aria-label={t('addColumn')}
              onClick={actions.onAddColumn}
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
