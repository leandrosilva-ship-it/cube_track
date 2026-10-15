'use client';

import { toCsv, type CellTextDirectory, type CellTextLocale } from '@cube-track/shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
} from '@cube-track/ui';
import {
  Archive,
  ArrowRightLeft,
  Copy,
  Download,
  FolderInput,
  PencilLine,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail, Item } from '@/lib/api/types';

import { downloadText } from '@/lib/download';
import { ValueEditor, type EditorValue } from './editors';
import type { ItemWrite } from './hooks';
import { cellTextOf, type GridColumn } from './model';

function BulkEdit({
  columns,
  items,
  directory,
  locale,
  onWrite,
}: {
  columns: readonly GridColumn[];
  items: readonly Item[];
  directory: CellTextDirectory;
  locale: CellTextLocale;
  onWrite: (writes: ItemWrite[], label: string) => Promise<boolean>;
}) {
  const t = useTranslations('table.bulk');
  const [open, setOpen] = useState(false);
  const writable = columns.filter((column) => column.column !== null && column.writable);
  const [key, setKey] = useState(writable[0]?.key ?? '');
  const [value, setValue] = useState<EditorValue>(null);
  const column = writable.find((entry) => entry.key === key)?.column ?? null;
  const apply = async () => {
    if (column === null) return;
    const writes = items
      .filter((item) => !item.redactedFields.includes(column.key))
      .map((item) => ({ item, values: { [column.key]: value } }));
    const ok = await onWrite(
      writes,
      t('undoLabel', { column: column.title, count: writes.length }),
    );
    if (ok) setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" disabled={writable.length === 0}>
          <PencilLine aria-hidden="true" />
          {t('edit')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-3" aria-label={t('edit')}>
        <Select
          aria-label={t('field')}
          value={key}
          options={writable.map((entry) => ({ value: entry.key, label: entry.title }))}
          onValueChange={(next) => {
            setKey(next);
            setValue(null);
          }}
        />
        {column === null ? null : (
          <ValueEditor
            key={column.key}
            column={column}
            value={value}
            mode="form"
            directory={directory}
            locale={locale}
            onChange={(next) => {
              setValue(next);
            }}
          />
        )}
        <Button size="sm" onClick={() => void apply()}>
          {value === null
            ? t('applyClear', { count: items.length })
            : t('apply', { count: items.length })}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** Barra de ações em massa (aparece com itens selecionados). */
export function BulkBar({
  board,
  items,
  columns,
  directory,
  locale,
  onWrite,
  onDuplicate,
  onMoveToGroup,
  onMoveToBoard,
  onArchive,
  onDelete,
  onClear,
}: {
  board: BoardDetail;
  items: readonly Item[];
  columns: readonly GridColumn[];
  directory: CellTextDirectory;
  locale: CellTextLocale;
  onWrite: (writes: ItemWrite[], label: string) => Promise<boolean>;
  onDuplicate: () => void;
  onMoveToGroup: (groupId: string) => void;
  onMoveToBoard: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const t = useTranslations('table.bulk');
  const canCreate = board.permissions.includes('item.create');
  const canDelete = board.permissions.includes('item.delete');
  const canUpdate =
    board.permissions.includes('item.update') || board.permissions.includes('item.update_assigned');
  const exportCsv = () => {
    const visible = columns.filter((column) => column.column !== null);
    const header = [columns[0]?.title ?? '', ...visible.map((column) => column.title)];
    const rows = items.map((item) => [
      item.name,
      ...visible.map((column) =>
        column.column === null ? '' : cellTextOf(item, column.column, directory, locale),
      ),
    ]);
    downloadText(`${board.name}.csv`, toCsv(header, rows, locale));
  };
  return (
    <div
      role="toolbar"
      aria-label={t('label', { count: items.length })}
      className="fixed inset-x-2 bottom-4 z-30 mx-auto flex max-w-fit flex-wrap items-center gap-1 rounded-xl border border-border bg-surface-raised px-3 py-2 shadow-lg"
    >
      <span
        className="me-2 inline-flex items-center gap-2 text-sm font-semibold"
        aria-live="polite"
      >
        <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary text-xs text-primary-foreground">
          {items.length}
        </span>
        {t('selected', { count: items.length })}
      </span>
      {canUpdate ? (
        <BulkEdit
          columns={columns}
          items={items}
          directory={directory}
          locale={locale}
          onWrite={onWrite}
        />
      ) : null}
      {canCreate ? (
        <Button size="sm" variant="ghost" onClick={onDuplicate}>
          <Copy aria-hidden="true" />
          {t('duplicate')}
        </Button>
      ) : null}
      {canUpdate ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <FolderInput aria-hidden="true" />
              {t('moveToGroup')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {board.groups.map((group) => (
              <DropdownMenuItem
                key={group.id}
                onSelect={() => {
                  onMoveToGroup(group.id);
                }}
              >
                <span
                  className="me-1 inline-block size-3 rounded-sm"
                  style={{ backgroundColor: group.color }}
                  aria-hidden="true"
                />
                {group.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canUpdate && canDelete ? (
        <Button size="sm" variant="ghost" onClick={onMoveToBoard}>
          <ArrowRightLeft aria-hidden="true" />
          {t('moveToBoard')}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onClick={exportCsv}>
        <Download aria-hidden="true" />
        {t('export')}
      </Button>
      {canDelete ? (
        <Button size="sm" variant="ghost" onClick={onArchive}>
          <Archive aria-hidden="true" />
          {t('archive')}
        </Button>
      ) : null}
      {canDelete ? (
        <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}>
          <Trash2 aria-hidden="true" />
          {t('delete')}
        </Button>
      ) : null}
      <Button size="icon-sm" variant="ghost" aria-label={t('clear')} onClick={onClear}>
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
