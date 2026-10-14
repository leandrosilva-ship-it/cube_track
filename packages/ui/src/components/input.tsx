import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cn } from '../lib/cn';

const fieldBase =
  'w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-subtle focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input ref={ref} type={type} className={cn(fieldBase, 'h-control', className)} {...props} />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, ...props },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(fieldBase, 'py-2', className)} {...props} />;
});
