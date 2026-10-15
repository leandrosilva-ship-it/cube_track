'use client';

import { Popover, PopoverContent, PopoverTrigger, cn } from '@cube-track/ui';
import {
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  FolderKanban,
  Gauge,
  Inbox,
  Landmark,
  LayoutGrid,
  Megaphone,
  Rocket,
  Scale,
  ShieldCheck,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Ícones disponíveis para boards (chave salva na API: `^[a-z0-9-]{1,40}$`). */
export const BOARD_ICONS: Record<string, LucideIcon> = {
  'layout-grid': LayoutGrid,
  briefcase: Briefcase,
  inbox: Inbox,
  'file-text': FileText,
  gauge: Gauge,
  'folder-kanban': FolderKanban,
  'clipboard-list': ClipboardList,
  calendar: CalendarDays,
  rocket: Rocket,
  target: Target,
  users: Users,
  landmark: Landmark,
  building: Building2,
  scale: Scale,
  shield: ShieldCheck,
  wrench: Wrench,
  megaphone: Megaphone,
};

export function BoardIcon({ icon, className }: { icon: string | null; className?: string }) {
  const Icon = (icon === null ? undefined : BOARD_ICONS[icon]) ?? LayoutGrid;
  return <Icon className={cn('size-5', className)} aria-hidden="true" />;
}

/** Seletor de ícone em popover (grade navegável por Tab; o selecionado tem aria-pressed). */
export function IconPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (icon: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('board');
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        aria-label={t('icon')}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-primary hover:bg-surface-hover disabled:cursor-default disabled:border-transparent disabled:hover:bg-transparent"
      >
        <BoardIcon icon={value} />
      </PopoverTrigger>
      <PopoverContent className="w-auto" aria-label={t('icon')}>
        <div className="grid grid-cols-6 gap-1">
          {Object.keys(BOARD_ICONS).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={value === key}
              aria-label={key}
              onClick={() => {
                onChange(key);
              }}
              className="inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-hover aria-pressed:bg-primary-soft aria-pressed:text-primary"
            >
              <BoardIcon icon={key} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
