import { Checkbox as CheckboxPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { cn } from '../lib/cn';

export const Checkbox = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

export const Switch = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 rounded-full bg-surface shadow-sm transition-transform data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4" />
    </SwitchPrimitive.Root>
  );
});
