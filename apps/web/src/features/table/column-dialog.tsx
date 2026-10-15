'use client';

import {
  AUTO_ID_RESET_PERIODS,
  COLUMN_TYPES,
  DEFAULT_AUTO_ID_MASK,
  FORMULA_FUNCTIONS,
  FormulaSyntaxError,
  MIRROR_AGGREGATES,
  NUMBER_UNIT_PRESETS,
  ROLLUP_AGGREGATES,
  defaultStatusLabels,
  displayFormula,
  isReadOnlyColumnType,
  normalizeFormulaReferences,
  parseFormula,
  type FilterGroup,
} from '@cube-track/shared';
import {
  Button,
  Checkbox,
  Field,
  Input,
  Label,
  Modal,
  Popover,
  PopoverContent,
  PopoverTrigger,
  STATUS_PALETTE,
  Select,
  Switch,
  Textarea,
  cn,
} from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState, type SubmitEvent } from 'react';

import { api } from '@/lib/api/client';
import type { BoardColumn, BoardDetail, StatusLabel } from '@/lib/api/types';
import { qk } from '@/lib/query/keys';

import { useMembers, useRoles } from '../shell/hooks';
import { ValueField, type EditorValue } from './editors';
import { FilterBuilder } from './filter-builder';
import { filterFields } from './filters';
import {
  useCellLocale,
  useColumnMutations,
  useDirectory,
  useWorkspaceBoards,
  type ColumnInput,
} from './hooks';

interface LabelDraft {
  id?: string;
  label: string;
  color: string;
  category: StatusLabel['category'];
}
interface OptionDraft {
  id?: string;
  label: string;
  color: string | null;
}

const CATEGORIES: StatusLabel['category'][] = ['not_started', 'in_progress', 'done', 'stuck'];
const NUMERIC_FORMAT_TYPES = new Set(['number', 'formula', 'rollup']);

export type ColumnDialogMode =
  | { kind: 'create'; afterKey?: string }
  | { kind: 'edit'; column: BoardColumn };

function ColorSwatch({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="size-8 shrink-0 rounded-md border border-border"
          style={{ backgroundColor: value }}
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <div className="grid grid-cols-5 gap-1" role="listbox" aria-label={label}>
          {STATUS_PALETTE.map((entry) => (
            <button
              key={entry.name}
              type="button"
              role="option"
              aria-selected={entry.color === value}
              aria-label={entry.color}
              onClick={() => {
                onChange(entry.color);
              }}
              className="size-7 rounded-sm aria-selected:ring-2 aria-selected:ring-primary"
              style={{ backgroundColor: entry.color }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LabelsEditor({
  labels,
  onChange,
}: {
  labels: LabelDraft[];
  onChange: (labels: LabelDraft[]) => void;
}) {
  const t = useTranslations('table.columnDialog');
  const move = (index: number, delta: number) => {
    const next = [...labels];
    const [entry] = next.splice(index, 1);
    if (entry !== undefined) next.splice(index + delta, 0, entry);
    onChange(next);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('labels')}</legend>
      {labels.map((label, index) => (
        <div key={label.id ?? `new-${String(index)}`} className="flex items-center gap-2">
          <ColorSwatch
            value={label.color}
            label={t('labelColor', { name: label.label })}
            onChange={(color) => {
              onChange(
                labels.map((entry, position) => (position === index ? { ...entry, color } : entry)),
              );
            }}
          />
          <Input
            value={label.label}
            maxLength={60}
            aria-label={t('labelName')}
            className="h-8 flex-1"
            onChange={(event) => {
              onChange(
                labels.map((entry, position) =>
                  position === index ? { ...entry, label: event.target.value } : entry,
                ),
              );
            }}
          />
          <Select
            className="h-8 w-36"
            aria-label={t('labelCategory')}
            value={label.category}
            options={CATEGORIES.map((category) => ({
              value: category,
              label: t(`categories.${category}`),
            }))}
            onValueChange={(category) => {
              onChange(
                labels.map((entry, position) =>
                  position === index
                    ? { ...entry, category: category as LabelDraft['category'] }
                    : entry,
                ),
              );
            }}
          />
          <button
            type="button"
            aria-label={t('moveUp')}
            disabled={index === 0}
            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-40"
            onClick={() => {
              move(index, -1);
            }}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('moveDown')}
            disabled={index === labels.length - 1}
            className="inline-flex size-7 items-center justify-center rounded-md hover:bg-surface-hover disabled:opacity-40"
            onClick={() => {
              move(index, 1);
            }}
          >
            <ArrowDown className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t('remove')}
            disabled={labels.length <= 1}
            className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover disabled:opacity-40"
            onClick={() => {
              onChange(labels.filter((_, position) => position !== index));
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={labels.length >= 40}
        onClick={() => {
          onChange([
            ...labels,
            {
              label: t('newLabel'),
              color: STATUS_PALETTE[labels.length % STATUS_PALETTE.length]?.color ?? '#579bfc',
              category: 'in_progress',
            },
          ]);
        }}
      >
        <Plus aria-hidden="true" />
        {t('addLabel')}
      </Button>
    </fieldset>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionDraft[];
  onChange: (options: OptionDraft[]) => void;
}) {
  const t = useTranslations('table.columnDialog');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{t('options')}</legend>
      {options.map((option, index) => (
        <div key={option.id ?? `new-${String(index)}`} className="flex items-center gap-2">
          <ColorSwatch
            value={option.color ?? '#c4c4c4'}
            label={t('labelColor', { name: option.label })}
            onChange={(color) => {
              onChange(
                options.map((entry, position) =>
                  position === index ? { ...entry, color } : entry,
                ),
              );
            }}
          />
          <Input
            value={option.label}
            maxLength={120}
            aria-label={t('optionName')}
            className="h-8 flex-1"
            onChange={(event) => {
              onChange(
                options.map((entry, position) =>
                  position === index ? { ...entry, label: event.target.value } : entry,
                ),
              );
            }}
          />
          <button
            type="button"
            aria-label={t('remove')}
            className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover"
            onClick={() => {
              onChange(options.filter((_, position) => position !== index));
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => {
          onChange([
            ...options,
            {
              label: t('newOption', { index: options.length + 1 }),
              color: STATUS_PALETTE[options.length % STATUS_PALETTE.length]?.color ?? null,
            },
          ]);
        }}
      >
        <Plus aria-hidden="true" />
        {t('addOption')}
      </Button>
    </fieldset>
  );
}

function RolePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('table.columnDialog');
  const roles = useRoles();
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-fg-muted">{value.length === 0 ? t('everyone') : t('onlyRoles')}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(roles.data ?? []).map((role) => (
          <div key={role.id} className="flex items-center gap-1.5 text-sm">
            <Checkbox
              id={`${id}-${role.id}`}
              checked={value.includes(role.id)}
              onCheckedChange={(next) => {
                onChange(
                  next === true ? [...value, role.id] : value.filter((entry) => entry !== role.id),
                );
              }}
            />
            <label htmlFor={`${id}-${role.id}`}>{role.name}</label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function FormulaField({
  value,
  onChange,
  columns,
  error,
}: {
  value: string;
  onChange: (expression: string) => void;
  columns: readonly BoardColumn[];
  error: string | null;
}) {
  const t = useTranslations('table.columnDialog');
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const insert = (text: string) => {
    const element = ref.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    onChange(`${value.slice(0, start)}${text}${value.slice(end)}`);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('formula')}</Label>
      <Textarea
        ref={ref}
        id={id}
        value={value}
        rows={4}
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={`${id}-hint${error === null ? '' : ` ${id}-error`}`}
        className="font-mono text-sm"
        placeholder="ROUND({UST} * {Valor UST}; 2)"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <p id={`${id}-hint`} className="text-xs text-fg-muted">
        {t('formulaHint', { example: 'IF({Status} = "Concluído"; 1; 0)' })}
      </p>
      {error === null ? null : (
        <p id={`${id}-error`} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <span className="text-xs font-semibold text-fg-muted">{t('insertColumn')}:</span>
        {columns.map((column) => (
          <button
            key={column.key}
            type="button"
            className="rounded-sm bg-surface-sunken px-1.5 text-xs hover:bg-surface-hover"
            onClick={() => {
              insert(`{${column.title}}`);
            }}
          >
            {column.title}
          </button>
        ))}
      </div>
      <details className="rounded-md border border-border p-2 text-xs">
        <summary className="cursor-pointer font-semibold">
          {t('functions', { count: FORMULA_FUNCTIONS.length })}
        </summary>
        <ul className="mt-2 grid max-h-48 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {FORMULA_FUNCTIONS.map((fn) => (
            <li key={fn.name}>
              <button
                type="button"
                className="w-full truncate rounded-sm px-1 text-start font-mono hover:bg-surface-hover"
                title={fn.signature}
                onClick={() => {
                  insert(`${fn.name}(`);
                }}
              >
                {fn.signature}
              </button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function useRelatedBoard(boardId: string | null) {
  return useQuery({
    queryKey: qk.boardDetail(boardId ?? 'none'),
    queryFn: () => api<BoardDetail>(`/v1/boards/${boardId ?? ''}`),
    enabled: boardId !== null,
  });
}

/** Coluna "rascunho" para o campo de valor padrão (mesmo editor das células). */
function draftColumn(
  base: BoardColumn | null,
  type: string,
  title: string,
  settings: Record<string, unknown>,
  labels: LabelDraft[],
  options: OptionDraft[],
): BoardColumn {
  return {
    id: base?.id ?? 'draft',
    key: base?.key ?? 'draft',
    type,
    title,
    description: null,
    settings,
    binding: null,
    isRequired: false,
    requiredWhen: null,
    defaultValue: null,
    isHidden: false,
    position: 'a0',
    width: null,
    permissions: {},
    canEdit: true,
    labels: labels.map((label, index) => ({
      id: label.id ?? `draft-${String(index)}`,
      columnId: 'draft',
      label: label.label,
      color: label.color,
      category: label.category,
      position: String(index),
    })),
    options: options.map((option, index) => ({
      id: option.id ?? `draft-${String(index)}`,
      columnId: 'draft',
      label: option.label,
      color: option.color,
      position: String(index),
    })),
  };
}

/** Criar ou configurar coluna (tipo, formato, fórmula, rótulos, obrigatoriedade, padrão, permissões). */
export function ColumnDialog({
  board,
  mode,
  onClose,
}: {
  board: BoardDetail;
  mode: ColumnDialogMode;
  onClose: () => void;
}) {
  const t = useTranslations('table.columnDialog');
  const tt = useTranslations('table.columnTypes');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const locale = useCellLocale();
  const members = useMembers();
  const directory = useDirectory([]);
  const mutations = useColumnMutations(board.id);
  const editing = mode.kind === 'edit' ? mode.column : null;
  const [type, setType] = useState(editing?.type ?? 'text');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [settings, setSettings] = useState<Record<string, unknown>>(() => ({
    ...(editing?.settings ?? {}),
  }));
  const [formula, setFormula] = useState(() =>
    editing?.type === 'formula' && typeof editing.settings.expression === 'string'
      ? displayFormula(editing.settings.expression, board.columns)
      : '',
  );
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [labels, setLabels] = useState<LabelDraft[]>(() =>
    editing === null
      ? defaultStatusLabels(locale).map((label) => ({ ...label, category: label.category }))
      : editing.labels.map((label) => ({
          id: label.id,
          label: label.label,
          color: label.color,
          category: label.category,
        })),
  );
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    (editing?.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      color: option.color,
    })),
  );
  const [isRequired, setIsRequired] = useState(editing?.isRequired ?? false);
  const [requiredWhen, setRequiredWhen] = useState<FilterGroup>(
    editing?.requiredWhen ?? { op: 'and', conditions: [] },
  );
  const [defaultValue, setDefaultValue] = useState<EditorValue>(editing?.defaultValue ?? null);
  const [editors, setEditors] = useState<string[]>(editing?.permissions.editors?.roleIds ?? []);
  const [viewers, setViewers] = useState<string[]>(editing?.permissions.viewers?.roleIds ?? []);
  const [titleError, setTitleError] = useState<string | null>(null);
  const boards = useWorkspaceBoards(
    board.workspaceId,
    type === 'board_relation' || type === 'mirror' || type === 'rollup',
  );

  const set = (key: string, value: unknown) => {
    setSettings((current) => {
      const next = { ...current };
      if (value === undefined || value === '' || value === null) Reflect.deleteProperty(next, key);
      else next[key] = value;
      return next;
    });
  };
  const str = (key: string) => (typeof settings[key] === 'string' ? settings[key] : '');
  const editingKey = editing?.key;
  const others = useMemo(
    () => board.columns.filter((column) => column.key !== editingKey),
    [board.columns, editingKey],
  );
  const relationColumns = others.filter((column) => column.type === 'board_relation');
  const relationColumn = relationColumns.find((column) => column.key === str('relationColumnKey'));
  const relatedBoardId =
    (type === 'mirror' || (type === 'rollup' && str('source') === 'relation')) &&
    Array.isArray(relationColumn?.settings.boardIds)
      ? String(relationColumn.settings.boardIds[0] ?? '') || null
      : null;
  const related = useRelatedBoard(relatedBoardId);
  const targetColumns =
    type === 'rollup' && str('source') !== 'relation' ? others : (related.data?.columns ?? []);
  const fields = useMemo(
    () =>
      filterFields(others, {
        name: t('fields.name'),
        group: t('fields.group'),
        createdAt: t('fields.createdAt'),
        updatedAt: t('fields.updatedAt'),
      }),
    [others, t],
  );
  const writable = !isReadOnlyColumnType(type) && type !== 'file' && type !== 'vote';
  const preview = draftColumn(editing, type, title, settings, labels, options);

  const typeOptions = COLUMN_TYPES.map((value) => ({ value, label: tt(value) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const saving =
    mutations.create.isPending ||
    mutations.update.isPending ||
    mutations.labels.isPending ||
    mutations.options.isPending;

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (title.trim() === '') {
      setTitleError(tv('required'));
      return;
    }
    const nextSettings = { ...settings };
    if (type === 'formula') {
      const expression = normalizeFormulaReferences(formula, board.columns);
      try {
        parseFormula(expression);
      } catch (error) {
        setFormulaError(
          error instanceof FormulaSyntaxError
            ? t('formulaError', { position: error.position + 1, message: error.message })
            : t('formulaInvalid'),
        );
        return;
      }
      nextSettings.expression = expression;
    }
    if (type === 'auto_id' && str('mask') === '') nextSettings.mask = DEFAULT_AUTO_ID_MASK;
    const permissions = {
      ...(editors.length === 0 ? {} : { editors: { roleIds: editors } }),
      ...(viewers.length === 0 ? {} : { viewers: { roleIds: viewers } }),
    };
    const condition = requiredWhen.conditions.length === 0 ? null : requiredWhen;
    const input: ColumnInput = {
      title: title.trim(),
      description: description.trim() === '' ? null : description.trim(),
      settings: nextSettings,
      isRequired,
      requiredWhen: condition,
      permissions,
    };
    try {
      if (editing === null) {
        const created = await mutations.create.mutateAsync({
          ...input,
          type,
          ...(mode.kind === 'create' && mode.afterKey !== undefined
            ? { position: { afterKey: mode.afterKey } }
            : {}),
          ...(type === 'status'
            ? {
                labels: labels.map(({ label, color, category }) => ({
                  label: label.trim() || '—',
                  color,
                  category,
                })),
              }
            : {}),
          ...(type === 'dropdown'
            ? {
                options: options.map(({ label, color }) => ({ label: label.trim() || '—', color })),
              }
            : {}),
        });
        if (defaultValue !== null && writable && type !== 'status' && type !== 'dropdown')
          await mutations.update.mutateAsync({ columnId: created.id, input: { defaultValue } });
      } else {
        await mutations.update.mutateAsync({
          columnId: editing.id,
          input: { ...input, ...(writable ? { defaultValue } : {}) },
        });
        if (type === 'status')
          await mutations.labels.mutateAsync({
            columnId: editing.id,
            labels: labels.map((label) => ({ ...label, label: label.label.trim() || '—' })),
          });
        if (type === 'dropdown')
          await mutations.options.mutateAsync({
            columnId: editing.id,
            options: options.map((option) => ({ ...option, label: option.label.trim() || '—' })),
          });
      }
      onClose();
    } catch {
      // O erro já foi exibido (toast) pela mutação; o diálogo fica aberto para correção.
    }
  };

  const numberFormat = NUMERIC_FORMAT_TYPES.has(type) ? (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label={t('unit')}>
        <Input
          value={str('unit')}
          maxLength={16}
          list="ct-unit-presets"
          onChange={(event) => {
            const preset = NUMBER_UNIT_PRESETS.find((entry) => entry.unit === event.target.value);
            set('unit', event.target.value);
            if (preset !== undefined) {
              set('unitPosition', preset.unitPosition);
              set('decimals', preset.decimals);
            }
          }}
        />
      </Field>
      <datalist id="ct-unit-presets">
        {NUMBER_UNIT_PRESETS.map((preset) => (
          <option key={preset.unit} value={preset.unit} />
        ))}
      </datalist>
      <Field label={t('unitPosition')}>
        <Select
          value={str('unitPosition') || 'suffix'}
          options={[
            { value: 'prefix', label: t('prefix') },
            { value: 'suffix', label: t('suffix') },
          ]}
          onValueChange={(value) => {
            set('unitPosition', value);
          }}
        />
      </Field>
      <Field label={t('decimals')}>
        <Select
          value={String(typeof settings.decimals === 'number' ? settings.decimals : 2)}
          options={[0, 1, 2, 3, 4].map((value) => ({ value: String(value), label: String(value) }))}
          onValueChange={(value) => {
            set('decimals', Number(value));
          }}
        />
      </Field>
    </div>
  ) : null;

  return (
    <Modal
      title={editing === null ? t('createTitle') : t('editTitle', { name: editing.title })}
      closeLabel={tc('close')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="column-dialog-form" loading={saving}>
            {editing === null ? tc('create') : tc('save')}
          </Button>
        </>
      }
    >
      <form
        id="column-dialog-form"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-5"
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('title')} required requiredLabel={tc('required')} error={titleError}>
            <Input
              value={title}
              maxLength={120}
              onChange={(event) => {
                setTitle(event.target.value);
                setTitleError(null);
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus -- foco inicial do diálogo
              autoFocus
            />
          </Field>
          <Field label={t('type')} {...(editing === null ? {} : { hint: t('typeLocked') })}>
            <Select
              value={type}
              disabled={editing !== null}
              options={typeOptions}
              onValueChange={(value) => {
                setType(value);
                setSettings({});
                setDefaultValue(null);
              }}
            />
          </Field>
        </div>
        <Field label={t('description')} hint={t('descriptionHint')}>
          <Textarea
            value={description}
            rows={2}
            maxLength={1000}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>

        <section className="flex flex-col gap-3" aria-label={t('settings')}>
          {type === 'status' ? (
            <>
              <LabelsEditor labels={labels} onChange={setLabels} />
              {editing !== null ? (
                <Field label={t('defaultLabel')}>
                  <Select
                    value={str('defaultLabelId') || 'none'}
                    options={[
                      { value: 'none', label: t('noDefault') },
                      ...editing.labels.map((label) => ({ value: label.id, label: label.label })),
                    ]}
                    onValueChange={(value) => {
                      set('defaultLabelId', value === 'none' ? undefined : value);
                    }}
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          {type === 'dropdown' ? (
            <>
              <OptionsEditor options={options} onChange={setOptions} />
              <div className="flex items-center gap-2">
                <Switch
                  id="ct-multiple"
                  checked={settings.multiple === true}
                  onCheckedChange={(next) => {
                    set('multiple', next ? true : undefined);
                  }}
                />
                <Label htmlFor="ct-multiple">{t('multiple')}</Label>
              </div>
            </>
          ) : null}
          {type === 'number' ? (
            <Field label={t('aggregate')}>
              <Select
                value={str('aggregate') || 'sum'}
                options={(['sum', 'avg', 'min', 'max', 'count', 'none'] as const).map((value) => ({
                  value,
                  label: t(`aggregates.${value}`),
                }))}
                onValueChange={(value) => {
                  set('aggregate', value);
                }}
              />
            </Field>
          ) : null}
          {type === 'formula' ? (
            <FormulaField
              value={formula}
              onChange={(next) => {
                setFormula(next);
                setFormulaError(null);
              }}
              columns={others}
              error={formulaError}
            />
          ) : null}
          {numberFormat}
          {type === 'text' ? (
            <Field label={t('maxLength')}>
              <Input
                type="number"
                min={1}
                max={2000}
                value={typeof settings.maxLength === 'number' ? settings.maxLength : ''}
                onChange={(event) => {
                  set(
                    'maxLength',
                    event.target.value === ''
                      ? undefined
                      : Math.min(2000, Math.max(1, Number(event.target.value))),
                  );
                }}
              />
            </Field>
          ) : null}
          {type === 'people' ? (
            <Field label={t('maxPeople')}>
              <Input
                type="number"
                min={1}
                value={typeof settings.maxPeople === 'number' ? settings.maxPeople : ''}
                onChange={(event) => {
                  set(
                    'maxPeople',
                    event.target.value === '' ? undefined : Math.max(1, Number(event.target.value)),
                  );
                }}
              />
            </Field>
          ) : null}
          {type === 'rating' ? (
            <Field label={t('maxRating')}>
              <Select
                value={String(typeof settings.max === 'number' ? settings.max : 5)}
                options={Array.from({ length: 10 }, (_, index) => ({
                  value: String(index + 1),
                  label: String(index + 1),
                }))}
                onValueChange={(value) => {
                  set('max', Number(value));
                }}
              />
            </Field>
          ) : null}
          {type === 'date' ? (
            <div className="flex items-center gap-2">
              <Switch
                id="ct-time"
                checked={settings.includeTime === true}
                onCheckedChange={(next) => {
                  set('includeTime', next ? true : undefined);
                }}
              />
              <Label htmlFor="ct-time">{t('includeTime')}</Label>
            </div>
          ) : null}
          {type === 'button' ? (
            <Field label={t('buttonLabel')}>
              <Input
                value={str('label')}
                maxLength={40}
                onChange={(event) => {
                  set('label', event.target.value);
                }}
              />
            </Field>
          ) : null}
          {type === 'auto_id' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t('mask')}
                hint={t('maskHint', { year: '{YYYY}', month: '{MM}', seq: '{SEQ:4}' })}
              >
                <Input
                  value={str('mask') || DEFAULT_AUTO_ID_MASK}
                  onChange={(event) => {
                    set('mask', event.target.value);
                  }}
                  className="font-mono"
                />
              </Field>
              <Field label={t('resetPeriod')}>
                <Select
                  value={str('resetPeriod') || 'never'}
                  options={AUTO_ID_RESET_PERIODS.map((value) => ({
                    value,
                    label: t(`reset.${value}`),
                  }))}
                  onValueChange={(value) => {
                    set('resetPeriod', value);
                  }}
                />
              </Field>
              <div className="flex items-center gap-2">
                <Switch
                  id="ct-subitems"
                  checked={settings.applyToSubitems === true}
                  onCheckedChange={(next) => {
                    set('applyToSubitems', next ? true : undefined);
                  }}
                />
                <Label htmlFor="ct-subitems">{t('applyToSubitems')}</Label>
              </div>
            </div>
          ) : null}
          {type === 'board_relation' ? (
            <>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium">{t('relatedBoards')}</legend>
                {[
                  { id: board.id, name: board.name },
                  ...(boards.data ?? []).filter((entry) => entry.id !== board.id),
                ].map((entry) => {
                  const ids = Array.isArray(settings.boardIds) ? settings.boardIds.map(String) : [];
                  return (
                    <div key={entry.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={`ct-board-${entry.id}`}
                        checked={ids.includes(entry.id)}
                        onCheckedChange={(next) => {
                          set(
                            'boardIds',
                            next === true
                              ? [...ids, entry.id]
                              : ids.filter((id) => id !== entry.id),
                          );
                        }}
                      />
                      <label htmlFor={`ct-board-${entry.id}`}>{entry.name}</label>
                    </div>
                  );
                })}
              </fieldset>
              <div className="flex items-center gap-2">
                <Switch
                  id="ct-allow-multiple"
                  checked={settings.allowMultiple !== false}
                  onCheckedChange={(next) => {
                    set('allowMultiple', next);
                  }}
                />
                <Label htmlFor="ct-allow-multiple">{t('allowMultiple')}</Label>
              </div>
            </>
          ) : null}
          {type === 'rollup' ? (
            <Field label={t('rollupSource')}>
              <Select
                value={str('source') || 'subitems'}
                options={[
                  { value: 'subitems', label: t('sourceSubitems') },
                  { value: 'relation', label: t('sourceRelation') },
                ]}
                onValueChange={(value) => {
                  set('source', value);
                }}
              />
            </Field>
          ) : null}
          {type === 'mirror' || (type === 'rollup' && str('source') === 'relation') ? (
            <Field label={t('relationColumn')}>
              <Select
                {...(str('relationColumnKey') === '' ? {} : { value: str('relationColumnKey') })}
                placeholder={t('pick')}
                options={relationColumns.map((column) => ({
                  value: column.key,
                  label: column.title,
                }))}
                onValueChange={(value) => {
                  set('relationColumnKey', value);
                }}
              />
            </Field>
          ) : null}
          {type === 'mirror' || type === 'rollup' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('targetColumn')}>
                <Select
                  {...(str('targetColumnKey') === '' ? {} : { value: str('targetColumnKey') })}
                  placeholder={t('pick')}
                  options={targetColumns.map((column) => ({
                    value: column.key,
                    label: column.title,
                  }))}
                  onValueChange={(value) => {
                    set('targetColumnKey', value);
                  }}
                />
              </Field>
              <Field label={t('aggregate')}>
                <Select
                  value={str('aggregate') || (type === 'mirror' ? 'list' : 'sum')}
                  options={(type === 'mirror' ? MIRROR_AGGREGATES : ROLLUP_AGGREGATES).map(
                    (value) => ({ value, label: t(`aggregates.${value}`) }),
                  )}
                  onValueChange={(value) => {
                    set('aggregate', value);
                  }}
                />
              </Field>
            </div>
          ) : null}
          {type === 'progress' ? (
            <>
              <Field label={t('progressMode')}>
                <Select
                  value={str('mode') || 'status_columns'}
                  options={[
                    { value: 'status_columns', label: t('progressStatus') },
                    { value: 'subitems', label: t('progressSubitems') },
                  ]}
                  onValueChange={(value) => {
                    set('mode', value);
                  }}
                />
              </Field>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-medium">{t('sourceColumns')}</legend>
                {others
                  .filter((column) => column.type === 'status')
                  .map((column) => {
                    const keys = Array.isArray(settings.sourceColumnKeys)
                      ? settings.sourceColumnKeys.map(String)
                      : [];
                    return (
                      <div key={column.key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`ct-src-${column.key}`}
                          checked={keys.includes(column.key)}
                          onCheckedChange={(next) => {
                            set(
                              'sourceColumnKeys',
                              next === true
                                ? [...keys, column.key]
                                : keys.filter((key) => key !== column.key),
                            );
                          }}
                        />
                        <label htmlFor={`ct-src-${column.key}`}>{column.title}</label>
                      </div>
                    );
                  })}
              </fieldset>
            </>
          ) : null}
        </section>

        {writable ? (
          <section
            className="flex flex-col gap-3 border-t border-border pt-4"
            aria-label={t('rules')}
          >
            <div className="flex items-center gap-2">
              <Switch id="ct-required" checked={isRequired} onCheckedChange={setIsRequired} />
              <Label htmlFor="ct-required">{t('required')}</Label>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t('requiredWhen')}</p>
              <p className="text-xs text-fg-muted">{t('requiredWhenHint')}</p>
              <FilterBuilder
                board={board}
                fields={fields}
                members={members.data ?? []}
                value={requiredWhen}
                onChange={setRequiredWhen}
                nested={false}
              />
            </div>
            {type !== 'status' ? (
              <div className={cn('flex flex-col gap-1.5')}>
                <p className="text-sm font-medium">{t('defaultValue')}</p>
                <ValueField
                  key={type}
                  column={preview}
                  value={defaultValue}
                  directory={directory}
                  locale={locale}
                  onChange={setDefaultValue}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        <section
          className="flex flex-col gap-3 border-t border-border pt-4"
          aria-label={t('permissions')}
        >
          <RolePicker label={t('viewers')} value={viewers} onChange={setViewers} />
          <RolePicker label={t('editors')} value={editors} onChange={setEditors} />
        </section>
      </form>
    </Modal>
  );
}
