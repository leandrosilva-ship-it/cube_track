'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LogoMark,
  Tooltip,
  cn,
} from '@cube-track/ui';
import {
  Bell,
  CalendarDays,
  Command,
  Home,
  Keyboard,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { openDialog, setPaletteOpen } from '@/stores/shell';

import { ConnectionIndicator } from './connection-indicator';
import { useUnreadCount } from './hooks';
import { UserMenu } from './user-menu';

interface NavEntry {
  href: string;
  key: 'home' | 'myWeek' | 'inbox' | 'favorites' | 'search' | 'ai';
  icon: LucideIcon;
}

export const NAV_ENTRIES: readonly NavEntry[] = [
  { href: '/', key: 'home', icon: Home },
  { href: '/my-week', key: 'myWeek', icon: CalendarDays },
  { href: '/inbox', key: 'inbox', icon: Bell },
  { href: '/favorites', key: 'favorites', icon: Star },
  { href: '/search', key: 'search', icon: Search },
  { href: '/ai', key: 'ai', icon: Sparkles },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

function RailLink({
  entry,
  label,
  badge,
  orientation,
}: {
  entry: NavEntry;
  label: string;
  badge?: ReactNode;
  orientation: 'vertical' | 'horizontal';
}) {
  const pathname = usePathname();
  const active = isActive(pathname, entry.href);
  const Icon = entry.icon;
  const link = (
    <Link
      href={entry.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
        orientation === 'vertical'
          ? 'size-10'
          : 'h-12 flex-1 flex-col gap-0.5 text-[10px] font-medium',
        active && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary',
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      {orientation === 'vertical' ? <span className="sr-only">{label}</span> : <span>{label}</span>}
      {badge}
    </Link>
  );
  return orientation === 'vertical' ? (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function UnreadBadge({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const t = useTranslations('inbox');
  const unread = useUnreadCount();
  const count = unread.data ?? 0;
  if (count === 0) return null;
  return (
    <span
      className={cn(
        'absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white',
        orientation === 'vertical' ? 'end-0.5 top-0.5' : 'end-1/4 top-1',
      )}
    >
      <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{t('unread', { count })}</span>
    </span>
  );
}

function MoreMenu({ orientation }: { orientation: 'vertical' | 'horizontal' }) {
  const t = useTranslations('shell.nav');
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('more')}
        className={cn(
          'flex items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg',
          orientation === 'vertical'
            ? 'size-10'
            : 'h-12 flex-1 flex-col gap-0.5 text-[10px] font-medium',
        )}
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
        {orientation === 'horizontal' ? <span>{t('more')}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={orientation === 'vertical' ? 'right' : 'top'} align="end">
        <DropdownMenuItem
          icon={<Command aria-hidden="true" />}
          shortcut="Ctrl K"
          onSelect={() => {
            setPaletteOpen(true);
          }}
        >
          {t('commandPalette')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Keyboard aria-hidden="true" />}
          shortcut="?"
          onSelect={() => {
            openDialog({ type: 'shortcuts' });
          }}
        >
          {t('shortcuts')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Settings aria-hidden="true" />}
          onSelect={() => {
            router.push('/settings');
          }}
        >
          {t('settings')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Barra de ícones fixa (desktop) / barra inferior (mobile). */
export function IconRail({
  orientation = 'vertical',
}: {
  orientation?: 'vertical' | 'horizontal';
}) {
  const t = useTranslations('shell.nav');
  if (orientation === 'horizontal') {
    const mobileEntries = NAV_ENTRIES.filter((entry) =>
      ['home', 'myWeek', 'inbox', 'search'].includes(entry.key),
    );
    return (
      <nav
        aria-label={t('label')}
        className="flex items-stretch gap-1 border-t border-border bg-surface px-2 pb-[env(safe-area-inset-bottom)]"
      >
        {mobileEntries.map((entry) => (
          <RailLink
            key={entry.key}
            entry={entry}
            label={t(entry.key)}
            orientation="horizontal"
            {...(entry.key === 'inbox' ? { badge: <UnreadBadge orientation="horizontal" /> } : {})}
          />
        ))}
        <MoreMenu orientation="horizontal" />
      </nav>
    );
  }
  return (
    <nav
      aria-label={t('label')}
      className="flex h-full w-14 flex-col items-center gap-1 border-e border-border bg-surface py-3"
    >
      <Link href="/" className="mb-2 rounded-md" aria-label={t('home')}>
        <LogoMark decorative className="size-8" />
      </Link>
      {NAV_ENTRIES.map((entry) => (
        <RailLink
          key={entry.key}
          entry={entry}
          label={t(entry.key)}
          orientation="vertical"
          {...(entry.key === 'inbox' ? { badge: <UnreadBadge orientation="vertical" /> } : {})}
        />
      ))}
      <MoreMenu orientation="vertical" />
      <div className="mt-auto flex flex-col items-center gap-3">
        <ConnectionIndicator />
        <UserMenu />
      </div>
    </nav>
  );
}
