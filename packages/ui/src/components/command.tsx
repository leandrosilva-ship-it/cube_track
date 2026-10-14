import { Command as CommandPrimitive } from 'cmdk';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Search } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Título acessível do diálogo (ex.: "Paleta de comandos"). */
  title: string;
  placeholder: string;
  emptyText: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  children: ReactNode;
  /** Filtragem própria (ex.: busca no servidor); padrão: filtro do cmdk. */
  shouldFilter?: boolean;
}

/** Paleta de comandos (Ctrl/⌘+K): busca, navegação por setas, Enter executa, Esc fecha. */
export function CommandDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  emptyText,
  search,
  onSearchChange,
  children,
  shouldFilter = true,
}: CommandDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ct-animate-in fixed inset-0 z-40 bg-overlay/50" />
        <DialogPrimitive.Content className="ct-animate-in fixed inset-x-4 top-[12vh] z-50 mx-auto max-w-xl overflow-hidden rounded-xl border border-border bg-surface-raised shadow-lg outline-none sm:inset-x-0">
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {placeholder}
          </DialogPrimitive.Description>
          <CommandPrimitive
            label={title}
            shouldFilter={shouldFilter}
            loop
            className="flex flex-col"
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-fg-muted" aria-hidden="true" />
              <CommandPrimitive.Input
                placeholder={placeholder}
                {...(search === undefined ? {} : { value: search })}
                {...(onSearchChange === undefined ? {} : { onValueChange: onSearchChange })}
                className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
              />
            </div>
            <CommandPrimitive.List className="max-h-[60vh] overflow-y-auto p-2">
              <CommandPrimitive.Empty className="py-8 text-center text-sm text-fg-muted">
                {emptyText}
              </CommandPrimitive.Empty>
              {children}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export interface CommandItemProps extends ComponentPropsWithoutRef<typeof CommandPrimitive.Item> {
  icon?: ReactNode;
  shortcut?: string;
}

export function CommandItem({ className, icon, shortcut, children, ...props }: CommandItemProps) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm text-fg outline-none data-[selected=true]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {shortcut === undefined ? null : <span className="text-xs text-fg-subtle">{shortcut}</span>}
    </CommandPrimitive.Item>
  );
}
