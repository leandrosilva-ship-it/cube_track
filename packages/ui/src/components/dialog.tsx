import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface SurfaceProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Rótulo do botão de fechar (vem do i18n do app). */
  closeLabel: string;
  className?: string;
}

function Overlay() {
  return <DialogPrimitive.Overlay className="ct-animate-in fixed inset-0 z-40 bg-overlay/50" />;
}

function Header({
  title,
  description,
  closeLabel,
}: Pick<SurfaceProps, 'title' | 'description' | 'closeLabel'>) {
  return (
    <div className="flex items-start gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-base font-semibold text-fg">
          {title}
        </DialogPrimitive.Title>
        {description === undefined ? (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="mt-1 text-sm text-fg-muted">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
      <DialogPrimitive.Close
        className="-me-1 inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
        aria-label={closeLabel}
      >
        <X className="size-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </div>
  );
}

/** Modal centralizado (foco preso, Esc fecha, foco devolvido ao gatilho). */
export function Modal({
  title,
  description,
  children,
  footer,
  closeLabel,
  className,
}: SurfaceProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'ct-animate-in fixed inset-x-4 top-[10vh] z-50 mx-auto flex max-h-[80vh] max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface-raised shadow-lg outline-none sm:inset-x-0',
          className,
        )}
      >
        <Header title={title} description={description} closeLabel={closeLabel} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer === undefined ? null : (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export interface DrawerProps extends SurfaceProps {
  side?: 'left' | 'right';
}

/** Painel lateral (ex.: painel do item, navegação mobile). */
export function Drawer({
  title,
  description,
  children,
  footer,
  closeLabel,
  className,
  side = 'right',
}: DrawerProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-50 flex w-full max-w-md flex-col bg-surface-raised shadow-lg outline-none',
          side === 'right'
            ? 'ct-slide-in-right end-0 border-s'
            : 'ct-slide-in-left start-0 border-e',
          'border-border',
          className,
        )}
      >
        <Header title={title} description={description} closeLabel={closeLabel} />
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer === undefined ? null : (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
