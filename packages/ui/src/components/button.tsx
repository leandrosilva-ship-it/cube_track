'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        secondary: 'border border-border bg-surface text-fg hover:bg-surface-hover',
        ghost: 'text-fg hover:bg-surface-hover',
        subtle: 'bg-primary-soft text-primary hover:bg-surface-hover',
        danger: 'bg-danger text-white hover:opacity-90 dark:text-overlay',
        link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-control px-3.5 text-sm',
        lg: 'h-11 px-5 text-base',
        icon: 'size-control p-0',
        'icon-sm': 'size-7 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Renderiza o filho (ex.: `<a>`/`<Link>`) com o estilo de botão. */
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    asChild = false,
    loading = false,
    disabled,
    children,
    type,
    ...props
  },
  ref,
) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? undefined : disabled === true || loading}
      aria-busy={loading || undefined}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner size="sm" /> : null}
          {children}
        </>
      )}
    </Component>
  );
});
