import { ContextMenu as ContextMenuPrimitive, DropdownMenu as MenuPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { cn } from '../lib/cn';

const contentClass =
  'ct-animate-in z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-surface-raised p-1 text-sm text-fg shadow-lg';
const itemClass =
  'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-fg-muted';

// ------------------------------------------------------------------- Menu suspenso (⋯) ---

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;
export const DropdownMenuSub = MenuPrimitive.Sub;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(function DropdownMenuContent({ className, sideOffset = 6, align = 'start', ...props }, ref) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        className={cn(contentClass, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
});

export interface MenuItemExtras {
  icon?: ReactNode;
  shortcut?: string;
  destructive?: boolean;
}

export const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & MenuItemExtras
>(function DropdownMenuItem({ className, icon, shortcut, destructive, children, ...props }, ref) {
  return (
    <MenuPrimitive.Item
      ref={ref}
      className={cn(
        itemClass,
        destructive === true && 'text-danger [&_svg]:text-danger',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut === undefined ? null : (
        <span className="ms-auto text-xs text-fg-subtle">{shortcut}</span>
      )}
    </MenuPrimitive.Item>
  );
});

export const DropdownMenuRadioItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.RadioItem ref={ref} className={cn(itemClass, 'ps-7', className)} {...props}>
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
});

export const DropdownMenuCheckboxItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof MenuPrimitive.CheckboxItem>
>(function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
  return (
    <MenuPrimitive.CheckboxItem ref={ref} className={cn(itemClass, 'ps-7', className)} {...props}>
      <span className="absolute start-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
});

export const DropdownMenuSubTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof MenuPrimitive.SubTrigger> & { icon?: ReactNode }
>(function DropdownMenuSubTrigger({ className, icon, children, ...props }, ref) {
  return (
    <MenuPrimitive.SubTrigger
      ref={ref}
      className={cn(itemClass, 'data-[state=open]:bg-surface-hover', className)}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      <span aria-hidden="true">›</span>
    </MenuPrimitive.SubTrigger>
  );
});

export const DropdownMenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof MenuPrimitive.SubContent>
>(function DropdownMenuSubContent({ className, ...props }, ref) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.SubContent ref={ref} className={cn(contentClass, className)} {...props} />
    </MenuPrimitive.Portal>
  );
});

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-semibold text-fg-muted', className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  );
}

// ---------------------------------------------------------------- Menu de contexto ---

export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

export const ContextMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(function ContextMenuContent({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content ref={ref} className={cn(contentClass, className)} {...props} />
    </ContextMenuPrimitive.Portal>
  );
});

export const ContextMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & MenuItemExtras
>(function ContextMenuItem({ className, icon, shortcut, destructive, children, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Item
      ref={ref}
      className={cn(
        itemClass,
        destructive === true && 'text-danger [&_svg]:text-danger',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut === undefined ? null : (
        <span className="ms-auto text-xs text-fg-subtle">{shortcut}</span>
      )}
    </ContextMenuPrimitive.Item>
  );
});

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}
