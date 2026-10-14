'use client';

import { Label as LabelPrimitive } from 'radix-ui';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cn } from '../lib/cn';

export const Label = forwardRef<
  HTMLLabelElement,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('text-sm font-medium text-fg', className)}
      {...props}
    />
  );
});

interface ControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** Controle único (Input, Select…); recebe id, aria-describedby e aria-invalid. */
  children: ReactElement<ControlProps>;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Texto que indica obrigatoriedade (vem do i18n do app). */
  requiredLabel?: string;
  className?: string;
}

/** Rótulo + controle + ajuda + erro, com associação ARIA completa. */
export function Field({
  label,
  children,
  hint,
  error,
  required,
  requiredLabel,
  className,
}: FieldProps) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId =
    error === undefined || error === null || error === false ? undefined : `${id}-error`;
  const describedBy =
    [hintId, errorId].filter((value) => value !== undefined).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        ...(errorId === undefined ? {} : { 'aria-invalid': true }),
        ...(required === true ? { required: true } : {}),
      })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required === true && requiredLabel !== undefined ? (
          <span className="ms-1 text-danger" aria-hidden="true">
            *<span className="sr-only">{requiredLabel}</span>
          </span>
        ) : null}
      </Label>
      {control}
      {hintId === undefined ? null : (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {errorId === undefined ? null : (
        <p id={errorId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
