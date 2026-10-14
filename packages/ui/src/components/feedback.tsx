import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Estado vazio com ícone, título, texto e ação principal. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      {icon === undefined ? null : (
        <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary [&_svg]:size-6">
          {icon}
        </div>
      )}
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {description === undefined ? null : (
        <p className="max-w-sm text-sm text-fg-muted">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Bloco de carregamento (decorativo; a região que carrega deve ter aria-busy). */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-surface-sunken', className)}
      {...props}
    />
  );
}

/** Tecla de atalho. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-sunken px-1 font-mono text-[11px] font-medium text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function Separator({
  orientation = 'horizontal',
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}

/** Conteúdo visível apenas para leitores de tela. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
