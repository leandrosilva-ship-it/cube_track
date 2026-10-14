'use client';

import { Button, EmptyState, Input, Skeleton, cn } from '@cube-track/ui';
import { ListTodo, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type SubmitEvent } from 'react';

import { newMutationId } from '@/lib/api/client';
import type { BoardColumn, BoardDetail, Item, Member } from '@/lib/api/types';

import { Cell, DISPLAYABLE_TYPES } from './cells';
import { useCreateItem, useRenameItem } from './hooks';
import type { BoardViewState } from './store';

interface Bucket {
  id: string;
  name: string;
  color: string;
  groupId: string | null;
  items: Item[];
}

const TYPE_PRIORITY = ['status', 'people', 'date', 'number', 'dropdown', 'text', 'checkbox'];
const typePriority = (type: string) => {
  const index = TYPE_PRIORITY.indexOf(type);
  return index === -1 ? TYPE_PRIORITY.length : index;
};

const byPosition = (a: Item, b: Item) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/** Agrupa itens por grupo do board ou por rótulo de uma coluna de status. */
export function bucketize(
  board: BoardDetail,
  items: readonly Item[],
  groupBy: string,
  keepOrder: boolean,
  noGroupLabel: string,
): Bucket[] {
  const ordered = keepOrder ? [...items] : [...items].sort(byPosition);
  if (groupBy === 'group') {
    return board.groups.map((group) => ({
      id: group.id,
      name: group.name,
      color: group.color,
      groupId: group.id,
      items: ordered.filter((item) => item.groupId === group.id),
    }));
  }
  const column = board.columns.find((entry) => entry.key === groupBy);
  if (column === undefined) return bucketize(board, items, 'group', keepOrder, noGroupLabel);
  const labelOf = (item: Item) =>
    (item.values[column.key] as { labelId?: string } | undefined)?.labelId;
  const buckets: Bucket[] = column.labels.map((label) => ({
    id: label.id,
    name: label.label,
    color: label.color,
    groupId: null,
    items: ordered.filter((item) => labelOf(item) === label.id),
  }));
  const known = new Set(column.labels.map((label) => label.id));
  buckets.push({
    id: 'none',
    name: noGroupLabel,
    color: '#c4c4c4',
    groupId: null,
    items: ordered.filter((item) => !known.has(labelOf(item) ?? '')),
  });
  return buckets.filter((bucket) => bucket.id !== 'none' || bucket.items.length > 0);
}

function ItemName({ item, boardId, canEdit }: { item: Item; boardId: string; canEdit: boolean }) {
  const tc = useTranslations('common');
  const rename = useRenameItem(boardId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const pending = item.version === 0;
  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name !== '' && name !== item.name)
      rename.mutate({ item, name, mutationId: newMutationId() });
  };
  if (editing) {
    return (
      <Input
        value={draft}
        aria-label={tc('rename')}
        className="h-8"
        maxLength={500}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(item.name);
            setEditing(false);
          }
        }}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
        autoFocus
      />
    );
  }
  if (!canEdit || pending) {
    return <span className={cn('block truncate', pending && 'text-fg-muted')}>{item.name}</span>;
  }
  return (
    <button
      type="button"
      className="block w-full truncate rounded-sm text-start hover:underline"
      title={tc('rename')}
      onClick={() => {
        setDraft(item.name);
        setEditing(true);
      }}
    >
      {item.name}
    </button>
  );
}

function AddItemRow({
  boardId,
  groupId,
  groupName,
}: {
  boardId: string;
  groupId: string;
  groupName: string;
}) {
  const t = useTranslations('board.items');
  const create = useCreateItem(boardId);
  const [name, setName] = useState('');
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return;
    create.mutate({
      groupId,
      name: trimmed,
      mutationId: newMutationId(),
      tempId: `temp-${newMutationId()}`,
    });
    setName('');
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2 px-3 py-1.5">
      <Plus className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
      <Input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        placeholder={t('addToGroup', { group: groupName })}
        aria-label={t('addToGroup', { group: groupName })}
        className="h-8 border-transparent bg-transparent hover:border-border"
      />
    </form>
  );
}

export interface ItemsListProps {
  board: BoardDetail;
  items: readonly Item[];
  loading: boolean;
  state: BoardViewState;
  members: ReadonlyMap<string, Member>;
  hasNextPage: boolean;
  fetchingNext: boolean;
  onLoadMore: () => void;
  filtered: boolean;
}

/** Lista agrupada de itens (visão simples até a Tabela virtualizada do Prompt 5). */
export function ItemsList({
  board,
  items,
  loading,
  state,
  members,
  hasNextPage,
  fetchingNext,
  onLoadMore,
  filtered,
}: ItemsListProps) {
  const t = useTranslations('board.items');
  const tc = useTranslations('common');
  const columns: BoardColumn[] = useMemo(
    () =>
      board.columns
        .filter(
          (column) =>
            DISPLAYABLE_TYPES.has(column.type) && !state.hiddenColumnKeys.includes(column.key),
        )
        // Mais informativas primeiro: status, pessoas e datas (mantendo a ordem do board).
        .map((column, index) => ({ column, index }))
        .sort(
          (a, b) => typePriority(a.column.type) - typePriority(b.column.type) || a.index - b.index,
        )
        .slice(0, 4)
        .map(({ column }) => column),
    [board.columns, state.hiddenColumnKeys],
  );
  const buckets = useMemo(
    () => bucketize(board, items, state.groupBy, state.sort !== undefined, t('noGroup')),
    [board, items, state.groupBy, state.sort, t],
  );
  const canCreate = board.permissions.includes('item.create');
  const canEditAll = board.permissions.includes('item.update');

  if (loading) {
    return (
      <div className="flex flex-col gap-2 px-4 sm:px-6" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (items.length === 0 && filtered) {
    return (
      <EmptyState
        className="mx-4 sm:mx-6"
        icon={<ListTodo aria-hidden="true" />}
        title={t('emptyFiltered')}
      />
    );
  }

  return (
    <div
      className="flex flex-col gap-6 px-4 pb-10 sm:px-6"
      aria-label={t('itemsLabel')}
      role="region"
    >
      {buckets.map((bucket) => (
        <section key={bucket.id} aria-labelledby={`bucket-${bucket.id}`}>
          <h2
            id={`bucket-${bucket.id}`}
            className="mb-2 flex items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--ct-text)' }}
          >
            <span
              className="h-4 w-1 rounded-full"
              style={{ backgroundColor: bucket.color }}
              aria-hidden="true"
            />
            {bucket.name}
            <span className="font-normal text-fg-muted">
              {t('count', { count: bucket.items.length })}
            </span>
          </h2>
          <div
            className="overflow-hidden rounded-lg border border-border bg-surface"
            style={{ borderInlineStartColor: bucket.color, borderInlineStartWidth: 4 }}
          >
            {bucket.items.length === 0 ? (
              <p className="px-3 py-3 text-sm text-fg-muted">{t('empty')}</p>
            ) : (
              <ul>
                {bucket.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex min-h-row flex-col gap-1 border-b border-border px-3 py-1.5 last:border-b-0 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="min-w-0 flex-1 text-sm">
                      <ItemName item={item} boardId={board.id} canEdit={canEditAll} />
                    </div>
                    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {columns.map((column) => (
                        <div key={column.key} className="flex min-w-0 items-center gap-1 sm:w-32">
                          <dt className="sr-only">{column.title}</dt>
                          <dd className="min-w-0">
                            <Cell item={item} column={column} members={members} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
            {canCreate && bucket.groupId !== null ? (
              <div className="border-t border-border">
                <AddItemRow boardId={board.id} groupId={bucket.groupId} groupName={bucket.name} />
              </div>
            ) : null}
          </div>
        </section>
      ))}
      {hasNextPage ? (
        <Button
          variant="secondary"
          className="self-center"
          loading={fetchingNext}
          onClick={onLoadMore}
        >
          {tc('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
