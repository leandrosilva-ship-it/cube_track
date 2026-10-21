'use client';

import type { KanbanConfig } from '@cube-track/shared';
import { Button, Checkbox, Field, Input, Label, Modal, Select, Switch, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import type { BoardDetail } from '@/lib/api/types';

import { GROUP_LEVEL_GROUP } from '../table/model';
import { kanbanBucketsFor, KANBAN_FIELD_TYPES } from './model';

export interface KanbanSettingsDialogProps {
  board: BoardDetail;
  config: KanbanConfig;
  onChange: (patch: Partial<KanbanConfig>) => void;
  onClose: () => void;
}

/** Configuração da view Kanban: colunas/raias por campo, cartões, limites de WIP (ADR 0045). */
export function KanbanSettingsDialog({ board, config, onChange, onClose }: KanbanSettingsDialogProps) {
  const t = useTranslations('kanban.settings');
  const tc = useTranslations('common');
  const tk = useTranslations('kanban');
  const [draft, setDraft] = useState<KanbanConfig>(config);

  const fieldColumns = useMemo(
    () => board.columns.filter((column) => KANBAN_FIELD_TYPES.has(column.type)),
    [board.columns],
  );
  const fieldOptions = [
    { value: GROUP_LEVEL_GROUP, label: t('byGroup') },
    ...fieldColumns.map((column) => ({ value: column.key, label: column.title })),
  ];
  const colorByOptions = [
    { value: '', label: t('none') },
    ...fieldColumns.map((column) => ({ value: column.key, label: column.title })),
  ];
  const labels = useMemo(
    () => ({
      none: tk('emptyColumn'),
      checked: tk('checked'),
      unchecked: tk('unchecked'),
      person: (id: string) => id,
    }),
    [tk],
  );
  const wipBuckets = useMemo(
    () => kanbanBucketsFor(board, draft.columnsBy, [], labels, false),
    [board, draft.columnsBy, labels],
  );

  const toggleCardField = (key: string) => {
    setDraft((current) => ({
      ...current,
      cardFields: current.cardFields.includes(key)
        ? current.cardFields.filter((entry) => entry !== key)
        : [...current.cardFields, key],
    }));
  };

  const setWipLimit = (key: string, value: string) => {
    setDraft((current) => {
      const parsed = Number.parseInt(value, 10);
      const entries = Object.entries(current.wipLimits).filter(([entryKey]) => entryKey !== key);
      if (value.trim() !== '' && !Number.isNaN(parsed)) {
        entries.push([key, Math.min(9_999, Math.max(1, parsed))]);
      }
      return { ...current, wipLimits: Object.fromEntries(entries) };
    });
  };

  const save = () => {
    onChange(draft);
    toast.success(t('saved'));
    onClose();
  };

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={save}>{tc('save')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('columnsBy')}>
            <Select
              value={draft.columnsBy}
              options={fieldOptions}
              onValueChange={(value) => {
                setDraft((current) => ({ ...current, columnsBy: value, wipLimits: {} }));
              }}
            />
          </Field>
          <Field label={t('swimlanesBy')}>
            <Select
              value={draft.swimlanesBy ?? ''}
              options={[{ value: '', label: t('noSwimlanes') }, ...fieldOptions]}
              onValueChange={(value) => {
                setDraft((current) => ({
                  ...current,
                  swimlanesBy: value === '' ? undefined : value,
                }));
              }}
            />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-fg">{t('cardFields')}</legend>
          <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto">
            {board.columns
              .filter((column) => column.key !== draft.columnsBy)
              .map((column) => (
                <label key={column.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={draft.cardFields.includes(column.key)}
                    onCheckedChange={() => {
                      toggleCardField(column.key);
                    }}
                  />
                  <span className="truncate">{column.title}</span>
                </label>
              ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('density')}>
            <Select
              value={draft.cardDensity}
              options={[
                { value: 'detailed', label: t('densityDetailed') },
                { value: 'compact', label: t('densityCompact') },
              ]}
              onValueChange={(value) => {
                setDraft((current) => ({
                  ...current,
                  cardDensity: value === 'compact' ? 'compact' : 'detailed',
                }));
              }}
            />
          </Field>
          <Field label={t('colorBy')}>
            <Select
              value={draft.colorBy ?? ''}
              options={colorByOptions}
              onValueChange={(value) => {
                setDraft((current) => ({ ...current, colorBy: value === '' ? undefined : value }));
              }}
            />
          </Field>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="ct-kanban-hide-empty"
            checked={draft.hideEmptyColumns}
            onCheckedChange={(checked) => {
              setDraft((current) => ({ ...current, hideEmptyColumns: checked }));
            }}
          />
          <Label htmlFor="ct-kanban-hide-empty">{t('hideEmptyColumns')}</Label>
        </div>

        <fieldset className="flex flex-col gap-2 border-t border-border pt-3">
          <legend className="text-sm font-medium text-fg">{t('wipLimits')}</legend>
          <div className="flex flex-col gap-2">
            {wipBuckets.map((bucket) => (
              <div key={bucket.key} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-sm">{bucket.label}</span>
                <Input
                  type="number"
                  min={1}
                  max={9_999}
                  aria-label={t('wipLimitFor', { label: bucket.label })}
                  className="w-24"
                  value={draft.wipLimits[bucket.key]?.toString() ?? ''}
                  onChange={(event) => {
                    setWipLimit(bucket.key, event.target.value);
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Switch
              id="ct-kanban-wip-block"
              checked={draft.wipBlock}
              onCheckedChange={(checked) => {
                setDraft((current) => ({ ...current, wipBlock: checked }));
              }}
            />
            <Label htmlFor="ct-kanban-wip-block">{t('wipBlock')}</Label>
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
