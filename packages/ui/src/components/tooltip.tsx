'use client';

import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Atalho exibido ao lado do texto (ex.: "Ctrl K"). */
  shortcut?: string;
  className?: string;
}

/** Dica ao passar o mouse ou focar (Radix: anunciada por leitores de tela via aria-describedby). */
export function Tooltip({ content, children, side = 'top', shortcut, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'ct-animate-in z-50 flex max-w-xs items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-surface shadow-md',
            className,
          )}
        >
          {content}
          {shortcut === undefined ? null : (
            <kbd className="rounded bg-surface/20 px-1 font-mono text-[10px]">{shortcut}</kbd>
          )}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
