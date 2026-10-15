'use client';

import {
  isFilterGroup,
  parseLocaleNumber,
  type FilterCondition,
  type FilterGroup,
  type FilterOperator,
} from '@cube-track/shared';
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  cn,
} from '@cube-track/ui';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId } from 'react';

import type { BoardDetail, Member } from '@/lib/api/types';

import { useCellLocale } from './hooks';
import {
  DATE_TOKEN_OPTIONS,
  changeOperator,
  initialCondition,
  operatorsFor,
  valueInputFor,
  type FilterField,
} from './filters';

type Node = FilterCondition | FilterGroup;

interface BuilderProps {
  board: BoardDetail;
  fields: readonly FilterField[];
  members: readonly Member[];
}

function MultiPicker({
  label,
  entries,
  value,
  onChange,
}: {
  label: string;
  entries: { id: string; label: string; color?: string | null }[];
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations('table.filters');
  const id = useId();
  const chosen = entries.filter((entry) => value.includes(entry.id));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-8 min-w-36 flex-1 items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-2 text-start text-sm"
        >
          <span className={cn('truncate', chosen.length === 0 && 'text-fg-subtle')}>
            {chosen.length === 0 ? t('pick') : chosen.map((entry) => entry.label).join(', ')}
          </span>
          <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={label} className="max-h-72 overflow-y-auto">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">{label}</legend>
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`${id}-${entry.id}`}
                checked={value.includes(entry.id)}
                onCheckedChange={(next) => {
                  onChange(
                    next === true
                      ? [...value, entry.id]
                      : value.filter((other) => other !== entry.id),
                  );
                }}
              />
              {entry.color === undefined ? null : (
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: entry.color ?? 'var(--ct-border)' }}
                  aria-hidden="true"
                />
              )}
              <label htmlFor={`${id}-${entry.id}`} className="truncate">
                {entry.label}
              </label>
            </div>
          ))}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

function ValueInput({
  condition,
  field,
  onChange,
  board,
  members,
}: {
  condition: FilterCondition;
  field: FilterField;
  onChange: (next: FilterCondition) => void;
} & Pick<BuilderProps, 'board' | 'members'>) {
  const t = useTranslations('table.filters');
  const locale = useCellLocale();
  const input = valueInputFor(field, condition.operator);
  const set = (value: FilterCondition['value']) => {
    onChange({ ...condition, ...(value === undefined ? {} : { value }) });
  };
  const list = Array.isArray(condition.value) ? condition.value.map(String) : [];
  const scalar =
    typeof condition.value === 'string' || typeof condition.value === 'number'
      ? String(condition.value)
      : '';
  switch (input) {
    case 'none':
      return null;
    case 'labels':
      return (
        <MultiPicker
          label={t('value')}
          value={list}
          onChange={set}
          entries={(field.column?.labels ?? []).map((label) => ({
            id: label.id,
            label: label.label,
            color: label.color,
          }))}
        />
      );
    case 'options':
      return (
        <MultiPicker
          label={t('value')}
          value={list}
          onChange={set}
          entries={(field.column?.options ?? []).map((option) => ({
            id: option.id,
            label: option.label,
            color: option.color,
          }))}
        />
      );
    case 'groups':
      return (
        <MultiPicker
          label={t('value')}
          value={list}
          onChange={set}
          entries={board.groups.map((group) => ({
            id: group.id,
            label: group.name,
            color: group.color,
          }))}
        />
      );
    case 'people':
      return (
        <MultiPicker
          label={t('value')}
          value={list}
          onChange={set}
          entries={[
            { id: 'me', label: t('me') },
            ...members
              .filter((member) => member.status === 'active')
              .map((member) => ({ id: member.userId, label: member.name })),
          ]}
        />
      );
    case 'tags':
      return (
        <Input
          className="h-8 min-w-36 flex-1"
          aria-label={t('value')}
          placeholder={t('tagsPlaceholder')}
          value={list.join(', ')}
          onChange={(event) => {
            set(
              event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag !== ''),
            );
          }}
        />
      );
    case 'checkbox':
      return (
        <Select
          className="h-8 min-w-36 flex-1"
          aria-label={t('value')}
          value={condition.value === false ? 'false' : 'true'}
          options={[
            { value: 'true', label: t('checked') },
            { value: 'false', label: t('unchecked') },
          ]}
          onValueChange={(value) => {
            set(value === 'true');
          }}
        />
      );
    case 'date': {
      const isToken = (DATE_TOKEN_OPTIONS as readonly string[]).includes(scalar);
      return (
        <div className="flex min-w-36 flex-1 gap-2">
          <Select
            className="h-8 flex-1"
            aria-label={t('dateKind')}
            value={isToken ? scalar : 'exact'}
            options={[
              ...DATE_TOKEN_OPTIONS.map((token) => ({ value: token, label: t(`tokens.${token}`) })),
              { value: 'exact', label: t('exactDate') },
            ]}
            onValueChange={(value) => {
              set(value === 'exact' ? '' : value);
            }}
          />
          {isToken ? null : (
            <Input
              type="date"
              className="h-8 w-40"
              aria-label={t('exactDate')}
              value={scalar}
              onChange={(event) => {
                set(event.target.value);
              }}
            />
          )}
        </div>
      );
    }
    case 'number':
      return (
        <Input
          className="h-8 min-w-24 flex-1"
          inputMode="decimal"
          aria-label={t('value')}
          defaultValue={scalar}
          onChange={(event) => {
            const parsed = parseLocaleNumber(event.target.value, locale);
            set(parsed ?? event.target.value);
          }}
        />
      );
    default:
      return (
        <Input
          className="h-8 min-w-36 flex-1"
          aria-label={t('value')}
          value={scalar}
          onChange={(event) => {
            set(event.target.value);
          }}
        />
      );
  }
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
  ...props
}: BuilderProps & {
  condition: FilterCondition;
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('table.filters');
  const field = props.fields.find((entry) => entry.key === condition.field) ?? props.fields[0];
  if (field === undefined) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('condition')}>
      <Select
        className="h-8 w-44"
        aria-label={t('field')}
        value={field.key}
        options={props.fields.map((entry) => ({ value: entry.key, label: entry.title }))}
        onValueChange={(key) => {
          const next = props.fields.find((entry) => entry.key === key);
          if (next !== undefined) onChange(initialCondition(next));
        }}
      />
      <Select
        className="h-8 w-40"
        aria-label={t('operator')}
        value={condition.operator}
        options={operatorsFor(field).map((operator) => ({
          value: operator,
          label: t(`operators.${operator}`),
        }))}
        onValueChange={(operator) => {
          onChange(changeOperator(condition, field, operator as FilterOperator));
        }}
      />
      <ValueInput
        condition={condition}
        field={field}
        onChange={onChange}
        board={props.board}
        members={props.members}
      />
      <button
        type="button"
        className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover"
        aria-label={t('remove')}
        onClick={onRemove}
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Construtor de filtros E/OU (até dois níveis), com tokens relativos ("eu", "hoje", "esta
 * semana", "atrasados"). Também configura a condição de "obrigatória quando" das colunas.
 */
export function FilterBuilder({
  value,
  onChange,
  nested = true,
  ...props
}: BuilderProps & { value: FilterGroup; onChange: (next: FilterGroup) => void; nested?: boolean }) {
  const t = useTranslations('table.filters');
  const first = props.fields.find((field) => field.column !== null) ?? props.fields[0];
  const update = (index: number, node: Node | null) => {
    const conditions = [...value.conditions];
    if (node === null) conditions.splice(index, 1);
    else conditions[index] = node;
    onChange({ ...value, conditions });
  };
  return (
    <div className="flex flex-col gap-2">
      {value.conditions.map((node, index) => (
        <div key={index} className="flex items-start gap-2">
          <span className="w-12 shrink-0 pt-1.5 text-xs font-semibold uppercase text-fg-muted">
            {index === 0 ? (
              t('where')
            ) : index === 1 ? (
              <button
                type="button"
                className="rounded-sm text-primary underline-offset-2 hover:underline"
                aria-label={t('toggleOperator')}
                onClick={() => {
                  onChange({ ...value, op: value.op === 'and' ? 'or' : 'and' });
                }}
              >
                {t(value.op)}
              </button>
            ) : (
              t(value.op)
            )}
          </span>
          <div className="min-w-0 flex-1">
            {isFilterGroup(node) ? (
              <div className="rounded-md border border-border bg-surface-sunken p-2">
                <FilterBuilder
                  {...props}
                  nested={false}
                  value={node}
                  onChange={(next) => {
                    update(index, next.conditions.length === 0 ? null : next);
                  }}
                />
              </div>
            ) : (
              <ConditionRow
                {...props}
                condition={node}
                onChange={(next) => {
                  update(index, next);
                }}
                onRemove={() => {
                  update(index, null);
                }}
              />
            )}
          </div>
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={first === undefined}
          onClick={() => {
            if (first !== undefined)
              onChange({ ...value, conditions: [...value.conditions, initialCondition(first)] });
          }}
        >
          <Plus aria-hidden="true" />
          {t('addCondition')}
        </Button>
        {nested ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={first === undefined}
            onClick={() => {
              if (first !== undefined)
                onChange({
                  ...value,
                  conditions: [
                    ...value.conditions,
                    {
                      op: value.op === 'and' ? 'or' : 'and',
                      conditions: [initialCondition(first)],
                    },
                  ],
                });
            }}
          >
            <Plus aria-hidden="true" />
            {t('addGroup')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
