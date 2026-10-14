import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';
import { accessiblePair } from '../lib/contrast';

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-sunken text-fg-muted',
        primary: 'bg-primary-soft text-primary',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export interface StatusPillProps {
  label: string;
  /** Cor do rótulo (hex). O texto escolhe automaticamente a cor de maior contraste. */
  color: string;
  className?: string;
}

/** Rótulo de status em cor viva com texto sempre legível (contraste AA). */
export function StatusPill({ label, color, className }: StatusPillProps) {
  const pair = accessiblePair(color);
  return (
    <span
      className={cn(
        'inline-flex h-7 min-w-24 items-center justify-center rounded-sm px-2 text-xs font-medium',
        className,
      )}
      style={{ backgroundColor: pair.background, color: pair.text }}
    >
      {label}
    </span>
  );
}
