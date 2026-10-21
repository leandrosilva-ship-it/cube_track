'use client';

import { Avatar, cn } from '@cube-track/ui';
import { AtSign } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';

import type { MentionCandidate } from './mention-candidates';

export interface MentionListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
  items: MentionCandidate[];
  command: (item: MentionCandidate) => void;
}

/** Lista flutuante de @menção (navegação por teclado via `onKeyDown`, exposta ao plugin Tiptap). */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected(0);
  }, [items]);

  const select = (index: number) => {
    const item = items[index];
    if (item !== undefined) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === 'ArrowDown') {
        setSelected((value) => (value + 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowUp') {
        setSelected((value) => (value - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        select(selected);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  return (
    <div
      role="listbox"
      className="max-h-64 w-64 overflow-auto rounded-md border border-border bg-surface py-1 shadow-lg"
    >
      {items.map((item, index) => (
        <button
          key={`${item.kind}-${item.id ?? 'everyone'}`}
          type="button"
          role="option"
          aria-selected={index === selected}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm',
            index === selected ? 'bg-surface-hover' : undefined,
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            select(index);
          }}
        >
          {item.kind === 'user' ? (
            <Avatar person={{ id: item.id ?? '', name: item.label, avatarUrl: item.avatarUrl ?? null }} size="sm" />
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-hover">
              <AtSign className="size-3.5" aria-hidden="true" />
            </span>
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
});
