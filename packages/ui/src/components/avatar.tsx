'use client';

import { Avatar as AvatarPrimitive } from 'radix-ui';

import { cn } from '../lib/cn';
import { readableTextOn } from '../lib/contrast';
import { STATUS_PALETTE } from '../tokens';

export interface AvatarPerson {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

const SIZES = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Cor estável por pessoa (hash do id na paleta de status). */
export function colorFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return STATUS_PALETTE[hash % STATUS_PALETTE.length]?.color ?? '#5559df';
}

export interface AvatarProps {
  person: AvatarPerson;
  size?: keyof typeof SIZES;
  className?: string;
  /** Anel indicando presença ativa. */
  ring?: boolean;
  /** Quando há texto visível com o nome ao lado, o avatar fica decorativo. */
  decorative?: boolean;
}

export function Avatar({
  person,
  size = 'md',
  className,
  ring = false,
  decorative = false,
}: AvatarProps) {
  const background = colorFor(person.id);
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold',
        SIZES[size],
        ring && 'ring-2 ring-success ring-offset-2 ring-offset-surface',
        className,
      )}
      style={{ backgroundColor: background, color: readableTextOn(background) }}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': person.name })}
    >
      {person.avatarUrl === undefined || person.avatarUrl === null || person.avatarUrl === '' ? (
        initials(person.name)
      ) : (
        <>
          <AvatarPrimitive.Image src={person.avatarUrl} alt="" className="size-full object-cover" />
          <AvatarPrimitive.Fallback delayMs={400}>{initials(person.name)}</AvatarPrimitive.Fallback>
        </>
      )}
    </AvatarPrimitive.Root>
  );
}

export interface AvatarGroupProps {
  people: readonly AvatarPerson[];
  max?: number;
  size?: keyof typeof SIZES;
  /** Rótulo acessível do grupo (ex.: "3 pessoas vendo este board"). */
  label: string;
  /** Texto do excedente (ex.: (n) => `mais ${n}`). */
  overflowLabel: (count: number) => string;
  ring?: boolean;
  className?: string;
}

/** Avatares sobrepostos com contador "+N"; o grupo inteiro tem um rótulo acessível. */
export function AvatarGroup({
  people,
  max = 4,
  size = 'sm',
  label,
  overflowLabel,
  ring = false,
  className,
}: AvatarGroupProps) {
  const visible = people.slice(0, max);
  const hidden = people.length - visible.length;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex items-center -space-x-1.5', className)}
    >
      {visible.map((person) => (
        <Avatar
          key={person.id}
          person={person}
          size={size}
          ring={ring}
          className="border-2 border-surface"
        />
      ))}
      {hidden > 0 ? (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full border-2 border-surface bg-surface-sunken font-semibold text-fg-muted',
            SIZES[size],
          )}
          aria-label={overflowLabel(hidden)}
          role="img"
        >
          +{hidden}
        </span>
      ) : null}
    </div>
  );
}
