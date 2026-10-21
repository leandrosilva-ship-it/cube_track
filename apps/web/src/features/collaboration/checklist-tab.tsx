'use client';

import { Button, Checkbox, EmptyState, IconButton, Input, Skeleton, cn } from '@cube-track/ui';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Checklist, ChecklistItemRow, Item } from '@/lib/api/types';

import { useChecklistActions, useChecklists } from './hooks';

/** Aba "Subitens e checklist": checklists do item com progresso calculado. */
export function ChecklistTab({ item, canManage }: { item: Item; canManage: boolean }) {
  const t = useTranslations('itemPanel');
  const checklists = useChecklists(item.id);
  const actions = useChecklistActions(item.id);
  const [newTitle, setNewTitle] = useState('');

  return (
    <div className="flex flex-col gap-4">
      {checklists.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-20" />
        </div>
      ) : (checklists.data ?? []).length === 0 ? (
        <EmptyState icon={<ClipboardList aria-hidden="true" />} title={t('checklist.empty')} />
      ) : (
        (checklists.data ?? []).map((checklist) => (
          <ChecklistCard key={checklist.id} checklist={checklist} canManage={canManage} actions={actions} />
        ))
      )}
      {canManage ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const title = newTitle.trim();
            if (title === '') return;
            void actions.createChecklist(title);
            setNewTitle('');
          }}
        >
          <Input
            value={newTitle}
            onChange={(event) => {
              setNewTitle(event.target.value);
            }}
            placeholder={t('checklist.newChecklist')}
            aria-label={t('checklist.newChecklist')}
          />
          <Button type="submit" size="sm" variant="subtle">
            <Plus aria-hidden="true" />
            {t('checklist.add')}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function ChecklistCard({
  checklist,
  canManage,
  actions,
}: {
  checklist: Checklist;
  canManage: boolean;
  actions: ReturnType<typeof useChecklistActions>;
}) {
  const t = useTranslations('itemPanel');
  const [newContent, setNewContent] = useState('');
  const percent = checklist.progress.total === 0 ? 0 : Math.round((checklist.progress.done / checklist.progress.total) * 100);

  return (
    <section className="rounded-lg border border-border p-3">
      <header className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-semibold">{checklist.title}</h3>
        <span className="text-xs text-fg-subtle">
          {checklist.progress.done}/{checklist.progress.total}
        </span>
        {canManage ? (
          <IconButton
            label={t('delete')}
            icon={<Trash2 aria-hidden="true" />}
            size="icon-sm"
            variant="ghost"
            onClick={() => {
              void actions.deleteChecklist(checklist.id);
            }}
          />
        ) : null}
      </header>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full rounded-full bg-success transition-[width]" style={{ width: `${String(percent)}%` }} />
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {checklist.items.map((row) => (
          <ChecklistItemRowView key={row.id} row={row} canManage={canManage} actions={actions} />
        ))}
      </ul>
      {canManage ? (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const content = newContent.trim();
            if (content === '') return;
            void actions.addItem(checklist.id, content);
            setNewContent('');
          }}
        >
          <Input
            value={newContent}
            onChange={(event) => {
              setNewContent(event.target.value);
            }}
            placeholder={t('checklist.newItem')}
            aria-label={t('checklist.newItem')}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="ghost">
            <Plus aria-hidden="true" />
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function ChecklistItemRowView({
  row,
  canManage,
  actions,
}: {
  row: ChecklistItemRow;
  canManage: boolean;
  actions: ReturnType<typeof useChecklistActions>;
}) {
  const t = useTranslations('itemPanel');
  return (
    <li className="group flex items-center gap-2">
      <Checkbox
        checked={row.isDone}
        disabled={!canManage}
        onCheckedChange={(checked) => {
          void actions.toggleItem(row.id, checked === true);
        }}
        aria-label={row.content}
      />
      <span className={cn('flex-1 text-sm', row.isDone && 'text-fg-subtle line-through')}>{row.content}</span>
      {canManage ? (
        <IconButton
          label={t('delete')}
          icon={<Trash2 aria-hidden="true" />}
          size="icon-sm"
          variant="ghost"
          className="opacity-0 group-hover:opacity-100"
          onClick={() => {
            void actions.deleteItem(row.id);
          }}
        />
      ) : null}
    </li>
  );
}
