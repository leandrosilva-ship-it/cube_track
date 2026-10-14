'use client';

import { LOCALE_LABELS, LOCALES, type Locale } from '@cube-track/i18n';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@cube-track/ui';
import { DropdownMenuTrigger } from '@cube-track/ui';
import { Building2, Languages, LogOut, Palette, Rows3, Settings } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { usePathname, useRouter } from '@/i18n/navigation';
import { signOut } from '@/lib/auth/session';
import {
  updatePreferences,
  usePreferences,
  type DensityPreference,
  type ThemePreference,
} from '@/stores/preferences';
import { useSession } from '@/stores/session';

/** Menu do usuário: preferências (tema, densidade, idioma), configurações e sair. */
export function UserMenu({ side = 'right' }: { side?: 'right' | 'top' | 'bottom' }) {
  const t = useTranslations('shell.user');
  const user = useSession((state) => state.user);
  const tenant = useSession((state) => state.tenant);
  const theme = usePreferences((state) => state.theme);
  const density = usePreferences((state) => state.density);
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  if (user === null) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label={`${t('menu')}: ${user.name}`}
      >
        <Avatar person={{ id: user.id, name: user.name }} size="md" decorative />
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate text-sm text-fg">{user.name}</span>
          <span className="truncate font-normal">{user.email}</span>
          {tenant === null ? null : (
            <span className="mt-1 truncate font-normal">{tenant.name}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Palette aria-hidden="true" />}>
            {t('theme')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                updatePreferences({ theme: value as ThemePreference });
              }}
            >
              <DropdownMenuRadioItem value="light">{t('light')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t('dark')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">{t('system')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Rows3 aria-hidden="true" />}>
            {t('density')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={density}
              onValueChange={(value) => {
                updatePreferences({ density: value as DensityPreference });
              }}
            >
              <DropdownMenuRadioItem value="comfortable">{t('comfortable')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">{t('compact')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={<Languages aria-hidden="true" />}>
            {t('language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(value) => {
                router.replace(`${pathname}${window.location.search}`, { locale: value as Locale });
              }}
            >
              {LOCALES.map((value) => (
                <DropdownMenuRadioItem key={value} value={value} lang={value}>
                  {LOCALE_LABELS[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Settings aria-hidden="true" />}
          onSelect={() => {
            router.push('/settings');
          }}
        >
          {t('settings')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Building2 aria-hidden="true" />}
          onSelect={() => {
            router.push('/organizations?next=/');
          }}
        >
          {t('switchOrganization')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<LogOut aria-hidden="true" />}
          onSelect={() => {
            void signOut().then(() => {
              router.replace('/login');
            });
          }}
        >
          {t('signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
