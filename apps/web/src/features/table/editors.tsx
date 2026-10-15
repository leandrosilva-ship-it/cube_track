'use client';

import {
  parseCellText,
  parseLocaleDate,
  type CellTextDirectory,
  type CellTextLocale,
} from '@cube-track/shared';
import {
  Avatar,
  Button,
  Calendar,
  Checkbox,
  Input,
  STATUS_PALETTE,
  StatusPill,
  Textarea,
  cn,
} from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, Star, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

import { api } from '@/lib/api/client';
import type { BoardColumn, Item, Page } from '@/lib/api/types';

/**
 * Editores de valor por tipo de coluna. O mesmo editor serve à célula da Tabela (`grid`: Enter
 * confirma, Esc cancela, escolher numa lista confirma) e a formulários (`form`: cada mudança é
 * repassada; o formulário decide quando salvar).
 */

export type EditorValue = Record<string, unknown> | null;

export interface EditorProps {
  column: BoardColumn;
  value: EditorValue;
  /** `commit` = confirmar e fechar (no modo grid). */
  onChange: (value: EditorValue, commit: boolean) => void;
  onCancel?: () => void;
  mode: 'grid' | 'form';
  directory: CellTextDirectory;
  locale: CellTextLocale;
  /** Tecla que iniciou a edição (substitui o texto, como nas planilhas). */
  initialText?: string;
  id?: string;
  'aria-describedby'?: string;
}

/** Tipos editados como texto livre (parse/validação compartilhados com colar e importar). */
const TEXTUAL = new Set(['text', 'number', 'email', 'phone', 'location', 'hour', 'country']);

function idsOf(value: EditorValue, key: string): string[] {
  const list = value?.[key];
  return Array.isArray(list) ? list.map(String) : [];
}

function textOf(column: BoardColumn, value: EditorValue, locale: CellTextLocale): string {
  if (value === null) return '';
  switch (column.type) {
    case 'number': {
      const n = typeof value.n === 'string' ? value.n : '';
      return locale === 'en' ? n : n.replace('.', ',');
    }
    case 'email':
      return typeof value.email === 'string' ? value.email : '';
    case 'phone':
      return typeof value.phone === 'string' ? value.phone : '';
    case 'location':
      return typeof value.address === 'string' ? value.address : '';
    case 'hour':
      return typeof value.time === 'string' ? value.time : '';
    case 'country':
      return typeof value.code === 'string' ? value.code : '';
    default:
      return typeof value.text === 'string' ? value.text : '';
  }
}

function gridKeys(
  event: KeyboardEvent,
  commit: () => void,
  cancel: (() => void) | undefined,
  multiline = false,
) {
  if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    commit();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    cancel?.();
  } else if (event.key === 'Tab') {
    // Tab confirma e deixa a grade mover a seleção.
    commit();
  }
}

// ------------------------------------------------------------------------------- textuais ---

function TextualEditor(props: EditorProps & { multiline?: boolean }) {
  const t = useTranslations('table.editors');
  const { column, value, onChange, onCancel, mode, directory, locale, multiline = false } = props;
  const [draft, setDraft] = useState(props.initialText ?? textOf(column, value, locale));
  const [invalid, setInvalid] = useState(false);
  const parse = (text: string) => {
    if (column.type === 'long_text') {
      const trimmed = text.trim();
      return { ok: true as const, value: trimmed === '' ? null : { text: trimmed } };
    }
    return parseCellText(column, text, directory, locale);
  };
  const commit = () => {
    const parsed = parse(draft);
    if (!parsed.ok) {
      setInvalid(true);
      return;
    }
    onChange(parsed.value, true);
  };
  const common = {
    id: props.id,
    value: draft,
    'aria-invalid': invalid,
    'aria-label': column.title,
    ...(props['aria-describedby'] === undefined
      ? {}
      : { 'aria-describedby': props['aria-describedby'] }),
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      setInvalid(false);
      if (mode === 'form') {
        const parsed = parse(event.target.value);
        if (parsed.ok) onChange(parsed.value, false);
        else setInvalid(event.target.value.trim() !== '');
      }
    },
    onBlur: mode === 'grid' ? commit : undefined,
    onKeyDown: (event: KeyboardEvent) => {
      if (mode === 'grid') gridKeys(event, commit, onCancel, multiline);
    },
  };
  return (
    <div className="flex w-full flex-col gap-1">
      {multiline ? (
        <Textarea
          {...common}
          rows={mode === 'grid' ? 6 : 4}
          className={cn(mode === 'grid' && 'min-w-72')}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
          autoFocus={mode === 'grid'}
        />
      ) : (
        <Input
          {...common}
          inputMode={
            column.type === 'number' ? 'decimal' : column.type === 'phone' ? 'tel' : undefined
          }
          type={column.type === 'email' ? 'email' : 'text'}
          maxLength={column.type === 'country' ? 2 : 2_000}
          placeholder={
            column.type === 'hour' ? '09:30' : column.type === 'country' ? 'BR' : undefined
          }
          className={cn(mode === 'grid' && 'h-full rounded-none border-primary')}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
          autoFocus={mode === 'grid'}
        />
      )}
      {invalid ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {t('invalid')}
        </p>
      ) : multiline && mode === 'grid' ? (
        <p className="text-xs text-fg-muted">{t('multilineHint')}</p>
      ) : null}
    </div>
  );
}

function LinkEditor(props: EditorProps) {
  const t = useTranslations('table.editors');
  const { value, onChange, onCancel, mode } = props;
  const [url, setUrl] = useState(
    props.initialText ?? (typeof value?.url === 'string' ? value.url : ''),
  );
  const [text, setText] = useState(typeof value?.text === 'string' ? value.text : '');
  const [invalid, setInvalid] = useState(false);
  const build = (nextUrl: string, nextText: string) => {
    if (nextUrl.trim() === '') return { ok: true as const, value: null };
    const parsed = parseCellText(props.column, nextUrl, props.directory, props.locale);
    if (!parsed.ok || parsed.value === null) return { ok: false as const };
    return {
      ok: true as const,
      value: { ...parsed.value, ...(nextText.trim() === '' ? {} : { text: nextText.trim() }) },
    };
  };
  const emit = (nextUrl: string, nextText: string, commit: boolean) => {
    const built = build(nextUrl, nextText);
    setInvalid(!built.ok);
    if (built.ok) onChange(built.value, commit);
  };
  const keys = (event: KeyboardEvent) => {
    if (mode === 'grid')
      gridKeys(
        event,
        () => {
          emit(url, text, true);
        },
        onCancel,
      );
  };
  return (
    <div className="flex min-w-64 flex-col gap-2">
      <Input
        id={props.id}
        value={url}
        type="url"
        aria-label={t('url')}
        placeholder="https://"
        aria-invalid={invalid}
        onChange={(event) => {
          setUrl(event.target.value);
          if (mode === 'form') emit(event.target.value, text, false);
        }}
        onKeyDown={keys}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
        autoFocus={mode === 'grid'}
      />
      <Input
        value={text}
        aria-label={t('linkText')}
        placeholder={t('linkText')}
        onChange={(event) => {
          setText(event.target.value);
          if (mode === 'form') emit(url, event.target.value, false);
        }}
        onKeyDown={keys}
      />
      {invalid ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {t('invalid')}
        </p>
      ) : null}
      {mode === 'grid' ? (
        <Button
          size="sm"
          onClick={() => {
            emit(url, text, true);
          }}
        >
          {t('apply')}
        </Button>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------------------- listas ---

function ClearButton({ onClear }: { onClear: () => void }) {
  const t = useTranslations('table.editors');
  return (
    <button
      type="button"
      onClick={onClear}
      className="mt-1 w-full rounded-md py-1.5 text-sm text-fg-muted hover:bg-surface-hover"
    >
      {t('clear')}
    </button>
  );
}

function StatusEditor({ column, value, onChange, mode }: EditorProps) {
  const t = useTranslations('table.editors');
  const current = typeof value?.labelId === 'string' ? value.labelId : null;
  return (
    <div role="listbox" aria-label={column.title} className="flex min-w-48 flex-col gap-1">
      {column.labels.map((label) => (
        <button
          key={label.id}
          type="button"
          role="option"
          aria-selected={current === label.id}
          onClick={() => {
            onChange({ labelId: label.id }, true);
          }}
          className="rounded-sm outline-offset-2 aria-selected:ring-2 aria-selected:ring-primary"
        >
          <StatusPill label={label.label} color={label.color} className="w-full" />
        </button>
      ))}
      {current !== null || mode === 'form' ? (
        <ClearButton
          onClear={() => {
            onChange(null, true);
          }}
        />
      ) : null}
      {column.labels.length === 0 ? <p className="text-sm text-fg-muted">{t('noLabels')}</p> : null}
    </div>
  );
}

function SearchableChecklist({
  label,
  entries,
  selected,
  multiple,
  onToggle,
  onDone,
  renderEntry,
  mode,
}: {
  label: string;
  entries: { id: string; label: string }[];
  selected: readonly string[];
  multiple: boolean;
  onToggle: (id: string) => void;
  onDone?: () => void;
  renderEntry?: (entry: { id: string; label: string }) => ReactNode;
  mode: 'grid' | 'form';
}) {
  const t = useTranslations('table.editors');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle === ''
      ? entries
      : entries.filter((entry) => entry.label.toLocaleLowerCase().includes(needle));
  }, [entries, query]);
  return (
    <div className="flex min-w-56 flex-col gap-2">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        placeholder={t('search')}
        aria-label={`${label}: ${t('search')}`}
        className="h-8"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
        autoFocus={mode === 'grid'}
        onKeyDown={(event) => {
          const first = filtered[0];
          if (event.key === 'Enter' && first !== undefined) {
            event.preventDefault();
            onToggle(first.id);
          }
        }}
      />
      <div
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple}
        className="flex max-h-60 flex-col gap-0.5 overflow-y-auto"
      >
        {filtered.map((entry) => {
          const isSelected = selected.includes(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => {
                onToggle(entry.id);
              }}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-hover aria-selected:bg-primary-soft"
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {isSelected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
              </span>
              {renderEntry === undefined ? (
                <span className="truncate">{entry.label}</span>
              ) : (
                renderEntry(entry)
              )}
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-fg-muted">{t('noResults')}</p>
        ) : null}
      </div>
      {multiple && mode === 'grid' && onDone !== undefined ? (
        <Button size="sm" onClick={onDone}>
          {t('apply')}
        </Button>
      ) : null}
    </div>
  );
}

function useMultiDraft(
  initial: string[],
  multiple: boolean,
  emit: (ids: string[], commit: boolean) => void,
) {
  const [ids, setIds] = useState(initial);
  const toggle = (id: string) => {
    if (!multiple) {
      const next = ids[0] === id ? [] : [id];
      setIds(next);
      emit(next, true);
      return;
    }
    const next = ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
    setIds(next);
    emit(next, false);
  };
  return { ids, toggle };
}

function DropdownEditor({ column, value, onChange, mode }: EditorProps) {
  const multiple = column.settings.multiple === true;
  const emit = (ids: string[], commit: boolean) => {
    onChange(ids.length === 0 ? null : { optionIds: ids }, commit);
  };
  const { ids, toggle } = useMultiDraft(idsOf(value, 'optionIds'), multiple, emit);
  return (
    <SearchableChecklist
      label={column.title}
      mode={mode}
      multiple={multiple}
      entries={column.options.map((option) => ({ id: option.id, label: option.label }))}
      selected={ids}
      onToggle={toggle}
      onDone={() => {
        emit(ids, true);
      }}
      renderEntry={(entry) => {
        const option = column.options.find((candidate) => candidate.id === entry.id);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="size-3 shrink-0 rounded-sm"
              style={{ backgroundColor: option?.color ?? 'var(--ct-border)' }}
              aria-hidden="true"
            />
            <span className="truncate">{entry.label}</span>
          </span>
        );
      }}
    />
  );
}

function PeopleEditor({ column, value, onChange, mode, directory }: EditorProps) {
  const max = typeof column.settings.maxPeople === 'number' ? column.settings.maxPeople : 200;
  const multiple = max > 1;
  const teamIds = idsOf(value, 'teamIds');
  const emit = (ids: string[], commit: boolean) => {
    onChange(
      ids.length + teamIds.length === 0 ? null : { personIds: ids.slice(0, max), teamIds },
      commit,
    );
  };
  const { ids, toggle } = useMultiDraft(idsOf(value, 'personIds'), multiple, emit);
  return (
    <SearchableChecklist
      label={column.title}
      mode={mode}
      multiple={multiple}
      entries={directory.people.map((person) => ({ id: person.id, label: person.name }))}
      selected={ids}
      onToggle={toggle}
      onDone={() => {
        emit(ids, true);
      }}
      renderEntry={(entry) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar
            person={{ id: entry.id, name: entry.label, avatarUrl: null }}
            size="xs"
            decorative
          />
          <span className="truncate">{entry.label}</span>
        </span>
      )}
    />
  );
}

function RelationEditor({ column, value, onChange, mode }: EditorProps) {
  const t = useTranslations('table.editors');
  const boardIds = Array.isArray(column.settings.boardIds)
    ? column.settings.boardIds.map(String)
    : [];
  const multiple = column.settings.allowMultiple !== false;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(query.trim());
    }, 250);
    return () => {
      clearTimeout(handle);
    };
  }, [query]);
  const candidates = useQuery({
    queryKey: ['relation-candidates', boardIds, debounced],
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        boardIds.map((boardId) =>
          api<Page<Item>>(`/v1/boards/${boardId}/items`, {
            signal,
            query: { limit: 20, ...(debounced === '' ? {} : { search: debounced }) },
          }),
        ),
      );
      return pages.flatMap((page) => page.data.map((item) => ({ id: item.id, label: item.name })));
    },
    enabled: boardIds.length > 0,
  });
  const emit = (ids: string[], commit: boolean) => {
    onChange(ids.length === 0 ? null : { itemIds: ids }, commit);
  };
  const { ids, toggle } = useMultiDraft(idsOf(value, 'itemIds'), multiple, emit);
  return (
    <div className="flex min-w-64 flex-col gap-2">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        placeholder={t('searchItems')}
        aria-label={`${column.title}: ${t('searchItems')}`}
        className="h-8"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
        autoFocus={mode === 'grid'}
      />
      <div
        role="listbox"
        aria-label={column.title}
        aria-multiselectable={multiple}
        aria-busy={candidates.isFetching}
        className="flex max-h-60 flex-col gap-0.5 overflow-y-auto"
      >
        {(candidates.data ?? []).map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={ids.includes(entry.id)}
            onClick={() => {
              toggle(entry.id);
            }}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-hover aria-selected:bg-primary-soft"
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {ids.includes(entry.id) ? (
                <Check className="size-4 text-primary" aria-hidden="true" />
              ) : null}
            </span>
            <span className="truncate">{entry.label}</span>
          </button>
        ))}
        {candidates.data?.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-fg-muted">{t('noResults')}</p>
        ) : null}
      </div>
      {multiple && mode === 'grid' ? (
        <Button
          size="sm"
          onClick={() => {
            emit(ids, true);
          }}
        >
          {t('apply')}
        </Button>
      ) : null}
    </div>
  );
}

function TagsEditor({ column, value, onChange, mode, onCancel, initialText }: EditorProps) {
  const t = useTranslations('table.editors');
  const [tags, setTags] = useState(idsOf(value, 'tags'));
  const [draft, setDraft] = useState(initialText ?? '');
  const emit = (next: string[], commit: boolean) => {
    onChange(next.length === 0 ? null : { tags: next }, commit);
  };
  const add = () => {
    const entries = draft
      .split(/[,;]/)
      .map((entry) => entry.trim().replace(/^#/, '').slice(0, 60))
      .filter((entry) => entry !== '' && !tags.includes(entry));
    setDraft('');
    if (entries.length === 0) return tags;
    const next = [...tags, ...entries].slice(0, 50);
    setTags(next);
    emit(next, false);
    return next;
  };
  return (
    <div className="flex min-w-64 flex-col gap-2">
      <ul className="flex flex-wrap gap-1" aria-label={column.title}>
        {tags.map((tag) => (
          <li
            key={tag}
            className="inline-flex items-center gap-1 rounded-sm bg-surface-sunken px-1.5 text-xs"
          >
            #{tag}
            <button
              type="button"
              aria-label={t('removeTag', { tag })}
              onClick={() => {
                const next = tags.filter((entry) => entry !== tag);
                setTags(next);
                emit(next, false);
              }}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <Input
        value={draft}
        placeholder={t('addTag')}
        aria-label={t('addTag')}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (draft.trim() === '' && mode === 'grid') emit(tags, true);
            else add();
          } else if (event.key === 'Escape' && mode === 'grid') {
            event.preventDefault();
            event.stopPropagation();
            onCancel?.();
          }
        }}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
        autoFocus={mode === 'grid'}
      />
      {mode === 'grid' ? (
        <Button
          size="sm"
          onClick={() => {
            emit(add(), true);
          }}
        >
          {t('apply')}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------- datas e outros ---

function DateEditor({ column, value, onChange, mode, locale }: EditorProps) {
  const t = useTranslations('table.editors');
  const includeTime = column.settings.includeTime === true;
  const date = typeof value?.d === 'string' ? value.d : null;
  const [time, setTime] = useState(typeof value?.time === 'string' ? value.time : '');
  const emit = (d: string | null, nextTime: string, commit: boolean) => {
    onChange(
      d === null
        ? null
        : { d, ...(includeTime && /^\d{2}:\d{2}$/.test(nextTime) ? { time: nextTime } : {}) },
      commit,
    );
  };
  return (
    <div className="flex flex-col gap-2">
      <Calendar
        value={date}
        locale={locale}
        onChange={(next) => {
          emit(next, time, !includeTime);
        }}
      />
      {includeTime ? (
        <Input
          type="time"
          value={time}
          aria-label={t('time')}
          onChange={(event) => {
            setTime(event.target.value);
            emit(date, event.target.value, false);
          }}
        />
      ) : null}
      {mode === 'grid' && includeTime ? (
        <Button
          size="sm"
          onClick={() => {
            emit(date, time, true);
          }}
        >
          {t('apply')}
        </Button>
      ) : null}
      {date !== null ? (
        <ClearButton
          onClear={() => {
            onChange(null, true);
          }}
        />
      ) : null}
    </div>
  );
}

function mondayOf(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function plusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function RangeEditor({ column, value, onChange, mode, locale }: EditorProps) {
  const t = useTranslations('table.editors');
  const [from, setFrom] = useState(typeof value?.from === 'string' ? value.from : null);
  const [to, setTo] = useState(typeof value?.to === 'string' ? value.to : null);
  if (column.type === 'week') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-fg-muted">{t('pickWeek')}</p>
        <Calendar
          value={from}
          locale={locale}
          onChange={(next) => {
            if (next === null) {
              onChange(null, true);
              return;
            }
            const monday = mondayOf(next);
            onChange({ from: monday, to: plusDays(monday, 6) }, true);
          }}
        />
      </div>
    );
  }
  const emit = (nextFrom: string | null, nextTo: string | null, commit: boolean) => {
    if (nextFrom === null) {
      onChange(null, commit);
      return;
    }
    const end = nextTo === null || nextTo < nextFrom ? nextFrom : nextTo;
    onChange({ from: nextFrom, to: end }, commit);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div>
          <p className="mb-1 text-xs font-semibold text-fg-muted">{t('from')}</p>
          <Calendar
            value={from}
            locale={locale}
            onChange={(next) => {
              setFrom(next);
              emit(next, to, false);
            }}
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-fg-muted">{t('to')}</p>
          <Calendar
            value={to}
            locale={locale}
            onChange={(next) => {
              setTo(next);
              emit(from, next, mode === 'grid' && from !== null);
            }}
          />
        </div>
      </div>
      {from !== null ? (
        <ClearButton
          onClear={() => {
            onChange(null, true);
          }}
        />
      ) : null}
    </div>
  );
}

function RatingEditor({ column, value, onChange }: EditorProps) {
  const t = useTranslations('table.editors');
  const max = typeof column.settings.max === 'number' ? column.settings.max : 5;
  const current = Number(value?.n ?? 0);
  return (
    <div role="radiogroup" aria-label={column.title} className="flex gap-1">
      {Array.from({ length: max }, (_, index) => {
        const n = index + 1;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={t('stars', { count: n })}
            onClick={() => {
              onChange(current === n ? null : { n: String(n) }, true);
            }}
            className="rounded-sm p-0.5 hover:bg-surface-hover"
          >
            <Star
              className={cn(
                'size-5',
                n <= current ? 'fill-warning text-warning' : 'text-border-strong',
              )}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

function ColorEditor({ column, value, onChange, mode }: EditorProps) {
  const t = useTranslations('table.editors');
  const current = typeof value?.color === 'string' ? value.color : '#579bfc';
  return (
    <div className="flex flex-col gap-2">
      <div role="listbox" aria-label={column.title} className="grid grid-cols-6 gap-1">
        {STATUS_PALETTE.map((entry) => (
          <button
            key={entry.name}
            type="button"
            role="option"
            aria-selected={current === entry.color}
            aria-label={entry.color}
            onClick={() => {
              onChange({ color: entry.color }, true);
            }}
            className="size-7 rounded-sm border border-border aria-selected:ring-2 aria-selected:ring-primary"
            style={{ backgroundColor: entry.color }}
          />
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        {t('customColor')}
        <input
          type="color"
          value={current}
          onChange={(event) => {
            onChange({ color: event.target.value }, false);
          }}
          className="h-8 w-12 cursor-pointer rounded-sm border border-border"
        />
      </label>
      {mode === 'grid' ? (
        <ClearButton
          onClear={() => {
            onChange(null, true);
          }}
        />
      ) : null}
    </div>
  );
}

function CheckboxEditor({ column, value, onChange, id }: EditorProps) {
  return (
    <Checkbox
      id={id}
      aria-label={column.title}
      checked={value?.checked === true}
      onCheckedChange={(next) => {
        onChange(next === true ? { checked: true } : null, true);
      }}
    />
  );
}

/** Editor do tipo da coluna; `null` quando o tipo não tem edição direta. */
export function ValueEditor(props: EditorProps): ReactNode {
  switch (props.column.type) {
    case 'status':
      return <StatusEditor {...props} />;
    case 'dropdown':
      return <DropdownEditor {...props} />;
    case 'people':
      return <PeopleEditor {...props} />;
    case 'board_relation':
      return <RelationEditor {...props} />;
    case 'tags':
      return <TagsEditor {...props} />;
    case 'date':
      return <DateEditor {...props} />;
    case 'timeline':
    case 'week':
      return <RangeEditor {...props} />;
    case 'rating':
      return <RatingEditor {...props} />;
    case 'color':
      return <ColorEditor {...props} />;
    case 'checkbox':
      return <CheckboxEditor {...props} />;
    case 'link':
      return <LinkEditor {...props} />;
    case 'long_text':
      return <TextualEditor {...props} multiline />;
    default:
      return TEXTUAL.has(props.column.type) ? <TextualEditor {...props} /> : null;
  }
}

/** Tipos editados direto na célula (input sobreposto) em vez de popover. */
export const INLINE_EDIT_TYPES = new Set([
  'text',
  'number',
  'email',
  'phone',
  'hour',
  'country',
  'location',
]);

/** Teclas imprimíveis iniciam edição nos tipos textuais (como numa planilha). */
export function startsTyping(type: string): boolean {
  return INLINE_EDIT_TYPES.has(type) || type === 'long_text' || type === 'tags' || type === 'link';
}

/** Campo de formulário com o editor do tipo (diálogos de obrigatórios e de valor padrão). */
export function ValueField({
  column,
  value,
  onChange,
  directory,
  locale,
}: {
  column: BoardColumn;
  value: EditorValue;
  onChange: (value: EditorValue) => void;
  directory: CellTextDirectory;
  locale: CellTextLocale;
}) {
  const id = useId();
  return (
    <ValueEditor
      id={id}
      column={column}
      value={value}
      mode="form"
      directory={directory}
      locale={locale}
      onChange={(next) => {
        onChange(next);
      }}
    />
  );
}

/** Interpretação de data digitada em filtros (aceita formatos do idioma). */
export function parseTypedDate(text: string, locale: CellTextLocale): string | null {
  return parseLocaleDate(text, locale)?.d ?? null;
}
