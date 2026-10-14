'use client';

import { Select as SelectPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '../lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

/** Seleção única acessível (listbox Radix, navegação por teclado e digitação para buscar). */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { options, placeholder, className, id, onValueChange, ...props },
  ref,
) {
  return (
    <SelectPrimitive.Root {...props} {...(onValueChange === undefined ? {} : { onValueChange })}>
      <SelectPrimitive.Trigger
        ref={ref}
        id={id}
        aria-label={props['aria-label']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={props['aria-invalid']}
        className={cn(
          'inline-flex h-control w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3 text-sm text-fg hover:border-fg-subtle data-[placeholder]:text-fg-subtle disabled:opacity-60 aria-invalid:border-danger',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-fg-muted" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="ct-animate-in z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled === true}
                className="relative flex cursor-default select-none items-center rounded-md py-1.5 ps-7 pe-2 text-sm text-fg outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover"
              >
                <span className="absolute start-2 flex size-4 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-4" aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </span>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
});
