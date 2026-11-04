'use client';

import { Button, Input, Textarea } from '@cube-track/ui';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type ReactNode } from 'react';

import type { BoardDetail, Item } from '@/lib/api/types';
import { useSession } from '@/stores/session';

import { useGenerateDescription } from '../ai/hooks';
import type { CellContext } from '../table/cells';
import { CellDisplay } from '../table/cells';
import type { EditorValue } from '../table/editors';
import { ValueField } from '../table/editors';
import { useClickButton, useDirectory, useCellLocale, useItemWriter, useTimer } from '../table/hooks';
import { canWriteColumn, cellValue, todayIn } from '../table/model';
import { useWorkspaces } from '../workspace/hooks';
import { useUpdateItemDescription } from './hooks';
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
  const workspaces = useWorkspaces();
  const aiModuleEnabled =
    (workspaces.data ?? []).find((entry) => entry.id === board.workspaceId)?.enabledModules.includes('ai') ===
    true;
  const canUseAi = aiModuleEnabled && board.permissions.includes('ai.use');
  const canEditDescription = board.permissions.includes('item.update');

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
      <DescriptionRow item={item} canEdit={canEditDescription} canUseAi={canUseAi} />
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

/** Linha "Descrição do serviço" (`item.descriptionText`, campo nativo fora do sistema de colunas) —
 * editável por quem tem `item.update`, com um botão opcional de geração por IA (`ai.use` + módulo
 * `ai` ativo no workspace). A sugestão da IA nunca é salva automaticamente: só a prévia com
 * Aplicar/Descartar grava, usando a mesma mutação que salva uma edição manual. */
function DescriptionRow({ item, canEdit, canUseAi }: { item: Item; canEdit: boolean; canUseAi: boolean }) {
  const t = useTranslations('ai.itemPanel');
  const update = useUpdateItemDescription(item.id);
  const generate = useGenerateDescription(item.id);
  const [value, setValue] = useState(item.descriptionText ?? '');
  const [synced, setSynced] = useState(item.descriptionText);
  const [focused, setFocused] = useState(false);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  if (item.descriptionText !== synced) {
    setSynced(item.descriptionText);
    if (!focused) setValue(item.descriptionText ?? '');
  }

  const save = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === (item.descriptionText ?? '')) return;
    update.mutate(trimmed === '' ? null : trimmed);
  };

  return (
    <FieldRow label={t('descriptionFieldLabel')}>
      <div className="flex flex-col gap-2">
        {canEdit ? (
          <Textarea
            value={value}
            rows={3}
            placeholder={t('descriptionPlaceholder')}
            aria-label={t('descriptionFieldLabel')}
            onFocus={() => {
              setFocused(true);
            }}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            onBlur={() => {
              setFocused(false);
              save(value);
            }}
          />
        ) : (
          <p className="text-sm text-fg">{item.descriptionText ?? t('descriptionPlaceholder')}</p>
        )}
        {canUseAi ? (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            loading={generate.isPending}
            onClick={() => {
              generate.mutate(undefined, {
                onSuccess: ({ description }) => {
                  setSuggestion(description);
                },
              });
            }}
          >
            <Sparkles aria-hidden="true" />
            {t('generateDescription')}
          </Button>
        ) : null}
        {suggestion !== null ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-2">
            <p className="text-xs font-semibold uppercase text-fg-subtle">{t('suggestionTitle')}</p>
            <p className="whitespace-pre-wrap text-sm text-fg">{suggestion}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!canEdit}
                onClick={() => {
                  setValue(suggestion);
                  save(suggestion);
                  setSuggestion(null);
                }}
              >
                {t('applySuggestion')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSuggestion(null);
                }}
              >
                {t('discardSuggestion')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </FieldRow>
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
