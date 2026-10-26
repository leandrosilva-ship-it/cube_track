'use client';

import { Input } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import type { BoardDetail, Item } from '@/lib/api/types';
import { useSession } from '@/stores/session';

import type { CellContext } from '../table/cells';
import { CellDisplay } from '../table/cells';
import type { EditorValue } from '../table/editors';
import { ValueField } from '../table/editors';
import { useClickButton, useDirectory, useCellLocale, useItemWriter, useTimer } from '../table/hooks';
import { canWriteColumn, cellValue, todayIn } from '../table/model';
import { useMe } from '../shell/hooks';

const SELF_INTERACTIVE_TYPES = new Set(['vote', 'time_tracking']);

/** Aba "Campos": todas as colunas do item, editáveis respeitando permissão e tipo. */
export function FieldsTab({ board, item }: { board: BoardDetail; item: Item }) {
  const t = useTranslations('itemPanel');
  const tCells = useTranslations('table.cells');
  const directory = useDirectory([item]);
  const locale = useCellLocale();
  const me = useMe();
  const userId = useSession((session) => session.user?.id ?? '');
  const timezone = me.data?.user.timezone ?? 'America/Sao_Paulo';
  const { write } = useItemWriter(board);
  const timer = useTimer(board.id);
  const clickButton = useClickButton();
  const [name, setName] = useState(item.name);
  const [nameFocused, setNameFocused] = useState(false);
  // Sincroniza com mudanças externas (ex.: outro usuário renomeou) sem sobrescrever uma edição em
  // andamento — ajuste de estado durante a renderização, não em efeito (evita um round-trip extra).
  const [syncedName, setSyncedName] = useState(item.name);
  if (item.name !== syncedName) {
    setSyncedName(item.name);
    if (!nameFocused) setName(item.name);
  }

  const context: CellContext = useMemo(
    () => ({
      directory,
      locale,
      today: todayIn(timezone),
      currentUserId: userId,
      t: tCells,
      itemNames: new Map([[item.id, item.name]]),
      predecessors: new Map(),
      isDone: () => false,
      onTimer: (target, column, action) => {
        timer.mutate({ itemId: target.id, columnKey: column.key, action });
      },
      onButtonClick: (target, column) => {
        clickButton.mutate({ itemId: target.id, columnKey: column.key });
      },
      pendingButtonKey: clickButton.isPending
        ? `${clickButton.variables.itemId}:${clickButton.variables.columnKey}`
        : null,
      onVote: (target, column) => {
        const current = (cellValue(target, column) as { userIds?: string[] } | null)?.userIds ?? [];
        const next = current.includes(userId)
          ? current.filter((id) => id !== userId)
          : [...current, userId];
        void write(
          [{ item: target, values: { [column.key]: next.length === 0 ? null : { userIds: next } } }],
          t('fields.undo', { column: column.title }),
        );
      },
    }),
    [clickButton, directory, item.id, item.name, locale, t, timer, timezone, tCells, userId, write],
  );

  const columns = board.columns.filter((column) => column.type !== 'dependency');

  return (
    <dl className="flex flex-col divide-y divide-border">
      <FieldRow label={t('fields.name')} required>
        <Input
          value={name}
          onFocus={() => {
            setNameFocused(true);
          }}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onBlur={() => {
            setNameFocused(false);
            const trimmed = name.trim();
            if (trimmed !== '' && trimmed !== item.name)
              void write([{ item, name: trimmed, values: {} }], t('fields.undo', { column: t('fields.name') }));
            else setName(item.name);
          }}
          aria-label={t('fields.name')}
        />
      </FieldRow>
      {columns.map((column) => (
        <FieldRow key={column.id} label={column.title} required={column.isRequired}>
          {SELF_INTERACTIVE_TYPES.has(column.type) ? (
            <CellDisplay item={item} column={column} context={context} />
          ) : canWriteColumn(board, column) ? (
            <ValueField
              column={column}
              value={cellValue(item, column) as EditorValue}
              directory={directory}
              locale={locale}
              onChange={(next) => {
                void write(
                  [{ item, values: { [column.key]: next } }],
                  t('fields.undo', { column: column.title }),
                );
              }}
            />
          ) : (
            <CellDisplay item={item} column={column} context={context} />
          )}
        </FieldRow>
      ))}
    </dl>
  );
}

function FieldRow({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 py-2.5 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-3">
      <dt className="text-sm font-medium text-fg-muted">
        {label}
        {required ? <span className="ms-0.5 text-danger">*</span> : null}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
