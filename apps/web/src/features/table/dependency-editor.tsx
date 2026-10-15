'use client';

import { Button, Input, Select } from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api/client';
import type { BoardDetail, Dependency, Item, Page } from '@/lib/api/types';

import { useDependencies, useItemName, useSetDependencies } from './hooks';

interface Draft {
  itemId: string;
  type: Dependency['type'];
  lagDays: number;
}

const TYPES: Dependency['type'][] = ['FS', 'SS', 'FF', 'SF'];

function PredecessorName({ id }: { id: string }) {
  const name = useItemName(id, undefined);
  return <span className="min-w-0 flex-1 truncate text-sm">{name.data ?? '…'}</span>;
}

/**
 * Predecessores do item (coluna de dependência): tipo FS/SS/FF/SF e defasagem em dias. O servidor
 * rejeita ciclos; o cronograma (worker) recalcula datas a partir daqui.
 */
export function DependencyEditor({
  board,
  item,
  onDone,
}: {
  board: BoardDetail;
  item: Item;
  onDone: () => void;
}) {
  const t = useTranslations('table.dependencies');
  const tc = useTranslations('common');
  const dependencies = useDependencies(board.id, true);
  const save = useSetDependencies(board.id);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const initial = useMemo(
    () =>
      dependencies.data
        ?.filter((dependency) => dependency.successorId === item.id)
        .map((dependency) => ({
          itemId: dependency.predecessorId,
          type: dependency.type,
          lagDays: dependency.lagDays,
        })) ?? null,
    [dependencies.data, item.id],
  );
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(query.trim());
    }, 250);
    return () => {
      clearTimeout(handle);
    };
  }, [query]);

  const candidates = useQuery({
    queryKey: ['dependency-candidates', board.id, debounced],
    queryFn: ({ signal }) =>
      api<Page<Item>>(`/v1/boards/${board.id}/items`, {
        signal,
        query: { limit: 10, search: debounced },
      }).then((page) => page.data),
    enabled: debounced !== '',
  });

  const current = draft ?? initial ?? [];
  const typeOptions = TYPES.map((value) => ({ value, label: t(`types.${value}`) }));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold">{t('title', { name: item.name })}</p>
      {current.length === 0 ? <p className="text-sm text-fg-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-2">
        {current.map((entry, index) => (
          <li key={entry.itemId} className="flex items-center gap-2">
            <PredecessorName id={entry.itemId} />
            <Select
              className="h-8 w-28"
              aria-label={t('type')}
              value={entry.type}
              options={typeOptions}
              onValueChange={(value) => {
                setDraft(
                  current.map((other, position) =>
                    position === index ? { ...other, type: value as Dependency['type'] } : other,
                  ),
                );
              }}
            />
            <Input
              type="number"
              className="h-8 w-20"
              aria-label={t('lag')}
              value={entry.lagDays}
              onChange={(event) => {
                const lagDays = Math.trunc(Number(event.target.value) || 0);
                setDraft(
                  current.map((other, position) =>
                    position === index ? { ...other, lagDays } : other,
                  ),
                );
              }}
            />
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover"
              aria-label={t('remove')}
              onClick={() => {
                setDraft(current.filter((_, position) => position !== index));
              }}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <Input
        value={query}
        placeholder={t('search')}
        aria-label={t('search')}
        className="h-8"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {(candidates.data ?? [])
        .filter(
          (candidate) =>
            candidate.id !== item.id && !current.some((entry) => entry.itemId === candidate.id),
        )
        .map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1 text-start text-sm hover:bg-surface-hover"
            onClick={() => {
              setDraft([...current, { itemId: candidate.id, type: 'FS', lagDays: 0 }]);
              setQuery('');
            }}
          >
            <Plus className="size-4 text-fg-muted" aria-hidden="true" />
            <span className="truncate">{candidate.name}</span>
          </button>
        ))}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button
          size="sm"
          loading={save.isPending}
          disabled={initial === null}
          onClick={() => {
            save.mutate({ itemId: item.id, predecessors: current }, { onSuccess: onDone });
          }}
        >
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}
