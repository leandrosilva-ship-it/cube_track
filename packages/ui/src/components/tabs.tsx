'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { cn } from '../lib/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn('flex items-center gap-1 border-b border-border', className)}
      {...props}
    />
  );
});

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        '-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent px-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg data-[state=active]:border-primary data-[state=active]:text-fg [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content ref={ref} className={cn('pt-4 outline-none', className)} {...props} />
  );
});
