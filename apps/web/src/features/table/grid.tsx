'use client';

import type { CellTextDirectory, CellTextLocale } from '@cube-track/shared';
import { Input, Popover, PopoverAnchor, PopoverContent, toast } from '@cube-track/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

import type { BoardDetail, Item } from '@/lib/api/types';

import type { CellContext } from './cells';
import {
  normalizeRange,
  parseTsv,
  planFillDown,
  planPaste,
  toTsv,
  type PastePlan,
} from './clipboard';
import { DependencyEditor } from './dependency-editor';
import { INLINE_EDIT_TYPES, ValueEditor, startsTyping, type EditorValue } from './editors';
import { GridHeader, HEADER_HEIGHT, type HeaderActions } from './grid-header';
import {
  ADD_COLUMN_WIDTH,
  AddRow,
  FooterRow,
  GroupHeaderRow,
  ItemRow,
  SELECT_COLUMN_WIDTH,
  cellDomId,
  type RowLayout,
} from './grid-rows';
import type { ItemWrite } from './hooks';
import { cellTextOf, cellValue, rowHeight, type GridColumn, type TableRow } from './model';

interface Position {
  itemId: string;
  col: number;
}

export interface TableGridProps {
  board: BoardDetail;
  rows: readonly TableRow[];
  columns: readonly GridColumn[];
  context: CellContext;
  directory: CellTextDirectory;
  locale: CellTextLocale;
  sort: string | undefined;
  mainStatusKey: string | null;
  headerActions: HeaderActions;
  selectedIds: ReadonlySet<string>;
  onSelectionChange: (next: Set<string>) => void;
  expanded: ReadonlySet<string>;
  onToggleExpand: (item: Item) => void;
  onToggleBucket: (path: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  canRenameGroups: boolean;
  groupMenu: (row: Extract<TableRow, { kind: 'header' }>) => ReactNode;
  onOpenRowMenu: (item: Item, anchor: { x: number; y: number }) => void;
  onWrite: (writes: ItemWrite[], label: string) => Promise<boolean>;
  onCreate: (input: { groupId: string; name: string; parentItemId: string | null }) => void;
  onUndo: () => void;
  onRedo: () => void;
  emptyState: ReactNode;
}

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Editor aberto numa célula: inline (textuais) ou em popover ancorado na célula. */
function CellEditorHost({
  item,
  column,
  initialText,
  directory,
  locale,
  board,
  onSave,
  onClose,
}: {
  item: Item;
  column: GridColumn;
  initialText: string | undefined;
  directory: CellTextDirectory;
  locale: CellTextLocale;
  board: BoardDetail;
  onSave: (value: EditorValue | string) => void;
  onClose: () => void;
}) {
  const tc = useTranslations('common');
  const draft = useRef<{ value: EditorValue } | null>(null);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && draft.current !== null) onSave(draft.current.value);
    onClose();
  };
  const cancel = () => {
    draft.current = null;
    finish(false);
  };
  if (column.column === null) {
    return (
      <NameEditor
        initial={initialText ?? item.name}
        label={tc('rename')}
        onSave={onSave}
        onClose={onClose}
      />
    );
  }
  const boardColumn = column.column;
  if (boardColumn.type === 'dependency') {
    return (
      <Popover
        open
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <PopoverAnchor asChild>
          <span className="absolute inset-0" />
        </PopoverAnchor>
        <PopoverContent className="w-96">
          <DependencyEditor
            board={board}
            item={item}
            onDone={() => {
              finish(false);
            }}
          />
        </PopoverContent>
      </Popover>
    );
  }
  const editor = (
    <ValueEditor
      column={boardColumn}
      value={(cellValue(item, boardColumn) as EditorValue) ?? null}
      mode="grid"
      directory={directory}
      locale={locale}
      {...(initialText === undefined ? {} : { initialText })}
      onChange={(value, commit) => {
        draft.current = { value };
        if (commit) finish(true);
      }}
      onCancel={cancel}
    />
  );
  if (INLINE_EDIT_TYPES.has(boardColumn.type)) {
    return <div className="absolute inset-0 z-10 min-w-full">{editor}</div>;
  }
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) finish(true);
      }}
    >
      <PopoverAnchor asChild>
        <span className="absolute inset-0" />
      </PopoverAnchor>
      <PopoverContent
        className="w-auto max-w-[min(32rem,calc(100vw-2rem))]"
        onEscapeKeyDown={() => {
          draft.current = null;
        }}
      >
        {editor}
      </PopoverContent>
    </Popover>
  );
}

function NameEditor({
  initial,
  label,
  onSave,
  onClose,
}: {
  initial: string;
  label: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim();
    if (name !== '') onSave(name.slice(0, 500));
    onClose();
  };
  return (
    <div className="absolute inset-0 z-10">
      <Input
        value={draft}
        aria-label={label}
        maxLength={500}
        className="h-full rounded-none border-primary"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            done.current = true;
            onClose();
          }
        }}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
        autoFocus
      />
    </div>
  );
}

/**
 * Grade da Tabela: virtualização de linhas e colunas (TanStack Virtual), colunas fixadas,
 * navegação por teclado no padrão de planilha (ARIA grid com `aria-activedescendant`), seleção
 * retangular, copiar/colar TSV, preencher para baixo, desfazer e edição por tipo de coluna.
 */
export function TableGrid(props: TableGridProps) {
  const {
    board,
    rows,
    columns,
    context,
    directory,
    locale,
    selectedIds,
    onSelectionChange,
    onWrite,
  } = props;
  const t = useTranslations('table');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1024);
  const [active, setActive] = useState<Position | null>(null);
  const [anchor, setAnchor] = useState<Position | null>(null);
  const [editing, setEditing] = useState<(Position & { initialText?: string }) | null>(null);
  const draggingRef = useRef(false);
  const lastSelectedRef = useRef<string | null>(null);
  const activeBeforeMouseDown = useRef<string | null>(null);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setViewportWidth(element.clientWidth);
    });
    observer.observe(element);
    setViewportWidth(element.clientWidth);
    return () => {
      observer.disconnect();
    };
  }, []);

  // ------------------------------------------------------------------------- layout ---
  const pinnedCount = columns.filter((column) => column.pinned).length;
  const pinnedWidth =
    SELECT_COLUMN_WIDTH +
    columns.slice(0, pinnedCount).reduce((sum, column) => sum + column.width, 0);
  const scrollColumns = columns.slice(pinnedCount);
  const totalWidth =
    pinnedWidth + scrollColumns.reduce((sum, column) => sum + column.width, 0) + ADD_COLUMN_WIDTH;
  const widthSignature = columns.map((column) => `${column.key}:${String(column.width)}`).join('|');

  const getRowKey = useCallback((index: number) => rows[index]?.id ?? index, [rows]);
  // A grade não é memoizada pelo React Compiler (TanStack Virtual devolve funções mutáveis);
  // as linhas são memoizadas manualmente (`ItemRow`).
  // eslint-disable-next-line react-hooks/incompatible-library -- ver acima
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row === undefined ? 36 : rowHeight(row);
    },
    getItemKey: getRowKey,
    overscan: 12,
    scrollPaddingStart: HEADER_HEIGHT,
  });
  const getColumnKey = useCallback(
    (index: number) => scrollColumns[index]?.key ?? index,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a assinatura de larguras cobre as colunas
    [widthSignature],
  );
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: scrollColumns.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => scrollColumns[index]?.width ?? 160,
    getItemKey: getColumnKey,
    overscan: 3,
    paddingStart: pinnedWidth,
    paddingEnd: ADD_COLUMN_WIDTH,
    scrollPaddingStart: pinnedWidth,
  });
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rows, rowVirtualizer]);
  useEffect(() => {
    columnVirtualizer.measure();
  }, [widthSignature, pinnedWidth, columnVirtualizer]);

  const virtualColumns = columnVirtualizer.getVirtualItems();
  const firstVisible = virtualColumns[0]?.index ?? 0;
  const lastVisible = virtualColumns.at(-1)?.index ?? -1;
  const layout: RowLayout = useMemo(
    () => ({
      columns,
      pinnedCount,
      pinnedWidth,
      totalWidth,
      visible: virtualColumns.map((virtual) => ({
        index: pinnedCount + virtual.index,
        start: virtual.start,
      })),
      key: `${String(firstVisible)}-${String(lastVisible)}-${widthSignature}-${String(pinnedCount)}`,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a chave resume a janela visível
    [firstVisible, lastVisible, widthSignature, pinnedCount, columns],
  );

  // -------------------------------------------------------------------- navegação ---
  const navRows = useMemo(() => {
    const indices: number[] = [];
    rows.forEach((row, index) => {
      if (row.kind === 'item') indices.push(index);
    });
    return indices;
  }, [rows]);
  const navItems = useMemo(
    () => navRows.map((index) => (rows[index] as Extract<TableRow, { kind: 'item' }>).item),
    [navRows, rows],
  );
  const navIndexOf = useMemo(
    () => new Map(navItems.map((item, index) => [item.id, index])),
    [navItems],
  );

  const activeNav = active === null ? undefined : navIndexOf.get(active.itemId);
  const anchorNav = anchor === null ? undefined : navIndexOf.get(anchor.itemId);
  const range =
    active !== null && activeNav !== undefined && anchor !== null && anchorNav !== undefined
      ? normalizeRange({ row: anchorNav, col: anchor.col }, { row: activeNav, col: active.col })
      : null;

  const scrollIntoView = useCallback(
    (nav: number, col: number) => {
      const rowIndex = navRows[nav];
      if (rowIndex !== undefined) rowVirtualizer.scrollToIndex(rowIndex, { align: 'auto' });
      if (col >= pinnedCount) columnVirtualizer.scrollToIndex(col - pinnedCount, { align: 'auto' });
    },
    [navRows, pinnedCount, rowVirtualizer, columnVirtualizer],
  );

  const moveTo = useCallback(
    (nav: number, col: number, extend: boolean) => {
      if (navItems.length === 0) return;
      const nextNav = Math.max(0, Math.min(navItems.length - 1, nav));
      const nextCol = Math.max(0, Math.min(columns.length - 1, col));
      const item = navItems[nextNav];
      if (item === undefined) return;
      const position = { itemId: item.id, col: nextCol };
      if (extend) setAnchor((current) => current ?? active ?? position);
      else setAnchor(position);
      setActive(position);
      scrollIntoView(nextNav, nextCol);
    },
    [active, columns.length, navItems, scrollIntoView],
  );

  const focusGrid = useCallback(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  // --------------------------------------------------------------------- escrita ---
  const reportRejected = useCallback(
    (plan: PastePlan) => {
      if (plan.rejected.length > 0)
        toast.warning(t('clipboard.rejected', { count: plan.rejected.length }));
    },
    [t],
  );

  const writePlan = useCallback(
    async (plan: PastePlan, label: string) => {
      reportRejected(plan);
      if (plan.writes.length === 0) return;
      await onWrite(
        plan.writes.map((write) => ({
          item: write.item,
          ...(write.name === undefined ? {} : { name: write.name }),
          values: write.values,
        })),
        label,
      );
    },
    [onWrite, reportRejected],
  );

  const saveCell = useCallback(
    (item: Item, column: GridColumn, value: EditorValue | string) => {
      if (column.column === null) {
        if (typeof value === 'string' && value !== item.name)
          void onWrite([{ item, name: value, values: {} }], t('undo.rename'));
        return;
      }
      if (typeof value === 'string' || sameValue(value, cellValue(item, column.column))) return;
      void onWrite(
        [{ item, values: { [column.key]: value } }],
        t('undo.edit', { column: column.title }),
      );
    },
    [onWrite, t],
  );

  const startEdit = useCallback(
    (nav: number, col: number, initialText?: string) => {
      const item = navItems[nav];
      const column = columns[col];
      if (item === undefined || !column?.editable) return;
      if (item.redactedFields.includes(column.key) || item.version === 0) return;
      if (column.column?.type === 'checkbox') {
        const checked =
          (cellValue(item, column.column) as { checked?: boolean } | null)?.checked === true;
        saveCell(item, column, checked ? null : { checked: true });
        return;
      }
      setEditing({ itemId: item.id, col, ...(initialText === undefined ? {} : { initialText }) });
    },
    [columns, navItems, saveCell],
  );

  const clearRange = useCallback(() => {
    if (range === null) return;
    const writes: ItemWrite[] = [];
    for (let row = range.top; row <= range.bottom; row += 1) {
      const item = navItems[row];
      if (item === undefined) continue;
      const values: ItemWrite['values'] = {};
      for (let col = range.left; col <= range.right; col += 1) {
        const column = columns[col];
        if (column?.column === null || !column?.writable) continue;
        if (item.redactedFields.includes(column.key)) continue;
        if (cellValue(item, column.column) !== null) values[column.key] = null;
      }
      if (Object.keys(values).length > 0) writes.push({ item, values });
    }
    if (writes.length > 0) void onWrite(writes, t('undo.clear', { count: writes.length }));
  }, [columns, navItems, onWrite, range, t]);

  const copyRange = useCallback((): string | null => {
    if (range === null) return null;
    const matrix: string[][] = [];
    for (let row = range.top; row <= range.bottom; row += 1) {
      const item = navItems[row];
      if (item === undefined) continue;
      const line: string[] = [];
      for (let col = range.left; col <= range.right; col += 1) {
        const column = columns[col];
        if (column === undefined) continue;
        line.push(
          column.column === null
            ? item.name
            : cellTextOf(item, column.column, directory, locale, false),
        );
      }
      matrix.push(line);
    }
    return toTsv(matrix);
  }, [columns, directory, locale, navItems, range]);

  // ---------------------------------------------------------------------- seleção ---
  const toggleRow = useCallback(
    (item: Item, extend: boolean) => {
      const next = new Set(selectedIds);
      const last =
        lastSelectedRef.current === null ? undefined : navIndexOf.get(lastSelectedRef.current);
      const current = navIndexOf.get(item.id);
      if (extend && last !== undefined && current !== undefined) {
        const [from, to] = last < current ? [last, current] : [current, last];
        for (let index = from; index <= to; index += 1) {
          const entry = navItems[index];
          if (entry !== undefined) next.add(entry.id);
        }
      } else if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      lastSelectedRef.current = item.id;
      onSelectionChange(next);
    },
    [navIndexOf, navItems, onSelectionChange, selectedIds],
  );

  const selectItems = useCallback(
    (items: readonly Item[], selected: boolean) => {
      const next = new Set(selectedIds);
      for (const item of items) {
        if (selected) next.add(item.id);
        else next.delete(item.id);
      }
      onSelectionChange(next);
    },
    [onSelectionChange, selectedIds],
  );

  // ---------------------------------------------------------------------- teclado ---
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing !== null || event.target !== event.currentTarget) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (mod && key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) props.onRedo();
      else props.onUndo();
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      event.preventDefault();
      props.onRedo();
      return;
    }
    if (navItems.length === 0) return;
    if (activeNav === undefined || active === null) {
      if (
        ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Tab'].includes(
          key,
        )
      ) {
        if (key === 'Tab') return;
        event.preventDefault();
        moveTo(0, 0, false);
      }
      return;
    }
    const pageSize = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / 36) - 1);
    const handled = (() => {
      switch (key) {
        case 'ArrowDown':
          moveTo(mod ? navItems.length - 1 : activeNav + 1, active.col, event.shiftKey);
          return true;
        case 'ArrowUp':
          moveTo(mod ? 0 : activeNav - 1, active.col, event.shiftKey);
          return true;
        case 'ArrowRight':
          moveTo(activeNav, mod ? columns.length - 1 : active.col + 1, event.shiftKey);
          return true;
        case 'ArrowLeft':
          moveTo(activeNav, mod ? 0 : active.col - 1, event.shiftKey);
          return true;
        case 'Tab':
          if (
            event.shiftKey
              ? active.col === 0 && activeNav === 0
              : active.col === columns.length - 1 && activeNav === navItems.length - 1
          )
            return false;
          if (event.shiftKey)
            moveTo(
              active.col === 0 ? activeNav - 1 : activeNav,
              active.col === 0 ? columns.length - 1 : active.col - 1,
              false,
            );
          else
            moveTo(
              active.col === columns.length - 1 ? activeNav + 1 : activeNav,
              active.col === columns.length - 1 ? 0 : active.col + 1,
              false,
            );
          return true;
        case 'Home':
          moveTo(mod ? 0 : activeNav, 0, event.shiftKey);
          return true;
        case 'End':
          moveTo(mod ? navItems.length - 1 : activeNav, columns.length - 1, event.shiftKey);
          return true;
        case 'PageDown':
          moveTo(activeNav + pageSize, active.col, event.shiftKey);
          return true;
        case 'PageUp':
          moveTo(activeNav - pageSize, active.col, event.shiftKey);
          return true;
        case 'Enter':
        case 'F2':
          startEdit(activeNav, active.col);
          return true;
        case 'Escape':
          setAnchor(active);
          if (range !== null && (range.top !== range.bottom || range.left !== range.right))
            return true;
          if (selectedIds.size > 0) onSelectionChange(new Set());
          return true;
        case 'Delete':
        case 'Backspace':
          clearRange();
          return true;
        case 'ContextMenu': {
          const item = navItems[activeNav];
          const element = document.getElementById(cellDomId(item?.id ?? '', active.col));
          const rect = element?.getBoundingClientRect();
          if (item !== undefined)
            props.onOpenRowMenu(item, { x: rect?.left ?? 0, y: rect?.bottom ?? 0 });
          return true;
        }
        case ' ': {
          const column = columns[active.col];
          const item = navItems[activeNav];
          if (item === undefined) return true;
          if (column?.column?.type === 'checkbox') startEdit(activeNav, active.col);
          else toggleRow(item, event.shiftKey);
          return true;
        }
        default:
          break;
      }
      if (mod && key.toLowerCase() === 'd') {
        if (range !== null)
          void writePlan(planFillDown(range, navItems, columns), t('undo.fillDown'));
        return true;
      }
      if (mod && key.toLowerCase() === 'a') {
        const last = navItems.at(-1);
        const first = navItems[0];
        if (first !== undefined && last !== undefined) {
          setAnchor({ itemId: first.id, col: 0 });
          setActive({ itemId: last.id, col: columns.length - 1 });
        }
        return true;
      }
      if (event.shiftKey && key === 'F10') {
        const item = navItems[activeNav];
        if (item !== undefined) props.onOpenRowMenu(item, { x: 0, y: 0 });
        return true;
      }
      const column = columns[active.col];
      if (
        key.length === 1 &&
        !mod &&
        !event.altKey &&
        column !== undefined &&
        (column.column === null || startsTyping(column.column.type))
      ) {
        startEdit(activeNav, active.col, key);
        return true;
      }
      return false;
    })();
    if (handled) event.preventDefault();
  };

  // ------------------------------------------------------------- área de transferência ---
  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing !== null) return;
    const text = copyRange();
    if (text === null) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
  };
  const onCut = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing !== null) return;
    onCopy(event);
    clearRange();
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing !== null || active === null || activeNav === undefined) return;
    const text = event.clipboardData.getData('text/plain');
    if (text === '') return;
    event.preventDefault();
    const matrix = parseTsv(text.replace(/\n$/, ''));
    const plan = planPaste(
      matrix,
      { row: activeNav, col: active.col },
      range,
      navItems,
      columns,
      directory,
      locale,
    );
    void writePlan(plan, t('undo.paste', { count: plan.writes.length }));
  };

  // ------------------------------------------------------------------------ mouse ---
  const cellFrom = (target: EventTarget): { nav: number; col: number } | null => {
    const element = (target as HTMLElement).closest<HTMLElement>('[data-row][data-col]');
    if (element === null) return null;
    const rowIndex = Number(element.dataset.row);
    const nav = navRows.indexOf(rowIndex);
    return nav === -1 ? null : { nav, col: Number(element.dataset.col) };
  };
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const cell = cellFrom(event.target);
    if (cell === null) return;
    if ((event.target as HTMLElement).closest('a,button,input,textarea,[role="option"]') !== null)
      return;
    const item = navItems[cell.nav];
    activeBeforeMouseDown.current =
      item !== undefined && active?.itemId === item.id && active.col === cell.col
        ? `${item.id}:${String(cell.col)}`
        : null;
    draggingRef.current = true;
    moveTo(cell.nav, cell.col, event.shiftKey);
    focusGrid();
    event.preventDefault();
  };
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!draggingRef.current || (event.buttons & 1) === 0) return;
    const cell = cellFrom(event.target);
    if (cell === null) return;
    const item = navItems[cell.nav];
    if (item === undefined || (active?.itemId === item.id && active.col === cell.col)) return;
    setActive({ itemId: item.id, col: cell.col });
  };
  const onMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    const cell = cellFrom(event.target);
    if (cell === null || event.shiftKey) return;
    const item = navItems[cell.nav];
    // Segundo clique na célula ativa abre o editor (como numa planilha).
    if (item !== undefined && activeBeforeMouseDown.current === `${item.id}:${String(cell.col)}`)
      startEdit(cell.nav, cell.col);
  };
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const cell = cellFrom(event.target);
    if (cell !== null) startEdit(cell.nav, cell.col);
  };

  // Seleção ativa some quando o item sai da lista (excluído, filtrado).
  useEffect(() => {
    if (active !== null && !navIndexOf.has(active.itemId)) {
      setActive(null);
      setAnchor(null);
    }
    if (editing !== null && !navIndexOf.has(editing.itemId)) setEditing(null);
  }, [active, editing, navIndexOf]);

  const editingNav = editing === null ? undefined : navIndexOf.get(editing.itemId);
  const editingItem = editingNav === undefined ? undefined : navItems[editingNav];
  const editingColumn = editing === null ? undefined : columns[editing.col];
  const editor =
    editing !== null && editingItem !== undefined && editingColumn !== undefined ? (
      <CellEditorHost
        key={`${editing.itemId}:${String(editing.col)}`}
        item={editingItem}
        column={editingColumn}
        initialText={editing.initialText}
        directory={directory}
        locale={locale}
        board={board}
        onSave={(value) => {
          saveCell(editingItem, editingColumn, value);
        }}
        onClose={() => {
          setEditing(null);
          focusGrid();
        }}
      />
    ) : null;

  const activeItem = activeNav === undefined ? undefined : navItems[activeNav];
  const activeDescendant =
    active !== null && activeItem !== undefined ? cellDomId(activeItem.id, active.col) : undefined;
  const allSelected = navItems.length > 0 && navItems.every((item) => selectedIds.has(item.id));

  return (
    <div
      ref={scrollRef}
      role="grid"
      tabIndex={0}
      aria-label={t('gridLabel', { board: board.name })}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length + 1}
      aria-multiselectable="true"
      aria-activedescendant={activeDescendant}
      className="relative h-full overflow-auto overscroll-contain bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      <GridHeader
        layout={layout}
        sort={props.sort}
        mainStatusKey={props.mainStatusKey}
        actions={props.headerActions}
        allSelected={allSelected}
        someSelected={selectedIds.size > 0}
        onSelectAll={(selected) => {
          onSelectionChange(selected ? new Set(navItems.map((item) => item.id)) : new Set());
        }}
      />
      <div
        role="rowgroup"
        className="relative"
        style={{ height: rowVirtualizer.getTotalSize(), width: totalWidth }}
      >
        {rowVirtualizer.getVirtualItems().map((virtual) => {
          const row = rows[virtual.index];
          if (row === undefined) return null;
          const style = {
            transform: `translateY(${String(virtual.start)}px)`,
            height: virtual.size,
          };
          switch (row.kind) {
            case 'item': {
              const nav = navIndexOf.get(row.id) ?? -1;
              const inRange = range !== null && nav >= range.top && nav <= range.bottom;
              const rangeLeft = range?.left ?? 0;
              const rangeRight = range?.right ?? 0;
              return (
                <ItemRow
                  key={virtual.key}
                  row={row}
                  rowIndex={virtual.index}
                  layout={layout}
                  context={context}
                  selected={selectedIds.has(row.id)}
                  activeCol={activeNav === nav && active !== null ? active.col : null}
                  range={inRange ? [rangeLeft, rangeRight] : null}
                  editingCol={editingNav === nav ? (editing?.col ?? null) : null}
                  editor={editingNav === nav ? editor : null}
                  expanded={props.expanded.has(row.id)}
                  canExpand={
                    row.depth === 0 &&
                    ((row.item.indicators?.subitems ?? 0) > 0 ||
                      board.permissions.includes('item.create'))
                  }
                  onSelect={toggleRow}
                  onToggleExpand={props.onToggleExpand}
                  onOpenMenu={props.onOpenRowMenu}
                  style={style}
                />
              );
            }
            case 'header':
              return (
                <GroupHeaderRow
                  key={virtual.key}
                  row={row}
                  rowIndex={virtual.index}
                  layout={layout}
                  viewportWidth={viewportWidth}
                  canRename={props.canRenameGroups}
                  allSelected={
                    row.bucket.items.length > 0 &&
                    row.bucket.items.every((item) => selectedIds.has(item.id))
                  }
                  onToggle={props.onToggleBucket}
                  onRename={props.onRenameGroup}
                  onSelectAll={selectItems}
                  menu={props.groupMenu(row)}
                  style={style}
                />
              );
            case 'add':
              return (
                <AddRow
                  key={virtual.key}
                  row={row}
                  rowIndex={virtual.index}
                  layout={layout}
                  viewportWidth={viewportWidth}
                  onCreate={props.onCreate}
                  style={style}
                />
              );
            case 'footer':
              return (
                <FooterRow
                  key={virtual.key}
                  row={row}
                  rowIndex={virtual.index}
                  layout={layout}
                  locale={locale}
                  style={style}
                />
              );
          }
        })}
      </div>
      {rows.length === 0 ? (
        <div className="sticky start-0 p-6" style={{ width: viewportWidth }}>
          {props.emptyState}
        </div>
      ) : null}
    </div>
  );
}
