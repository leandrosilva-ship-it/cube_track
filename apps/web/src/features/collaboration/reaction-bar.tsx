'use client';

import { Popover, PopoverContent, PopoverTrigger, cn } from '@cube-track/ui';
import { SmilePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ReactionSummary } from '@/lib/api/types';

const QUICK_EMOJI = ['👍', '❤️', '😄', '🎉', '👀', '🙏'];

/** Reações (emoji) de uma atualização ou resposta: alterna a própria reação, mostra as já existentes. */
export function ReactionBar({
  reactions,
  onToggle,
}: {
  reactions: readonly ReactionSummary[];
  onToggle: (emoji: string) => void;
}) {
  const t = useTranslations('itemPanel');
  return (
    <div className="flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          aria-pressed={reaction.reactedByMe}
          onClick={() => {
            onToggle(reaction.emoji);
          }}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs',
            reaction.reactedByMe
              ? 'border-primary bg-primary-soft text-primary'
              : 'border-border text-fg-muted hover:bg-surface-hover',
          )}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('reactions.add')}
            className="inline-flex size-6 items-center justify-center rounded-full text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <SmilePlus className="size-3.5" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent aria-label={t('reactions.add')} className="flex w-auto gap-1 p-1.5">
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggle(emoji);
              }}
              className="inline-flex size-7 items-center justify-center rounded-md text-base hover:bg-surface-hover"
            >
              {emoji}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
