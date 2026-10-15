'use client';

import { formatDate } from '@cube-track/i18n';
import { Button, Checkbox, EmptyState, Modal, Skeleton } from '@cube-track/ui';
import { Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail } from '@/lib/api/types';

import { useGroupMutations, useItemActions, useTrash } from './hooks';

/** Lixeira do board: itens e grupos excluídos podem ser restaurados por 30 dias. */
export function TrashDialog({ board, onClose }: { board: BoardDetail; onClose: () => void }) {
  const t = useTranslations('table.trash');
  const tc = useTranslations('common');
  const locale = useLocale();
  const trash = useTrash(board.id, true);
  const actions = useItemActions(board);
  const groups = useGroupMutations(board.id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const items = trash.data?.items ?? [];
  const deletedGroups = trash.data?.groups ?? [];
  const canRestore =
    board.permissions.includes('item.delete') || board.permissions.includes('board.manage');

  const restore = async () => {
    setBusy(true);
    const result = await actions({ action: 'restore', itemIds: [...selected] });
    setBusy(false);
    if (result !== null) setSelected(new Set());
  };

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
          {canRestore ? (
            <Button disabled={selected.size === 0} loading={busy} onClick={() => void restore()}>
              {t('restoreSelected', { count: selected.size })}
            </Button>
          ) : null}
        </>
      }
    >
      {trash.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : items.length === 0 && deletedGroups.length === 0 ? (
        <EmptyState icon={<Trash2 aria-hidden="true" />} title={t('empty')} />
      ) : (
        <div className="flex flex-col gap-4">
          {deletedGroups.length > 0 ? (
            <section aria-label={t('groups')}>
              <h3 className="mb-2 text-sm font-semibold">{t('groups')}</h3>
              <ul className="flex flex-col gap-1">
                {deletedGroups.map((group) => (
                  <li
                    key={group.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover"
                  >
                    <span
                      className="h-4 w-1 rounded-full"
                      style={{ backgroundColor: group.color }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{group.name}</span>
                    {group.expiresAt === null ? null : (
                      <span className="text-xs text-fg-muted">
                        {t('expires', { date: formatDate(group.expiresAt.slice(0, 10), locale) })}
                      </span>
                    )}
                    {canRestore ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={groups.restore.isPending}
                        onClick={() => {
                          groups.restore.mutate(group.id);
                        }}
                      >
                        {t('restore')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {items.length > 0 ? (
            <section aria-label={t('items')}>
              <h3 className="mb-2 text-sm font-semibold">{t('items')}</h3>
              <ul className="flex flex-col gap-1">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover"
                  >
                    <Checkbox
                      id={`trash-${item.id}`}
                      checked={selected.has(item.id)}
                      disabled={!canRestore}
                      onCheckedChange={(next) => {
                        const copy = new Set(selected);
                        if (next === true) copy.add(item.id);
                        else copy.delete(item.id);
                        setSelected(copy);
                      }}
                    />
                    <label htmlFor={`trash-${item.id}`} className="min-w-0 flex-1 truncate">
                      {item.name}
                      <span className="ms-2 text-xs text-fg-muted">{item.groupName}</span>
                    </label>
                    {item.expiresAt === null ? null : (
                      <span className="shrink-0 text-xs text-fg-muted">
                        {t('expires', { date: formatDate(item.expiresAt.slice(0, 10), locale) })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
