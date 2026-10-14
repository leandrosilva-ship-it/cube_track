'use client';

import { IconButton } from '@cube-track/ui';
import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { updatePreferences, usePreferences } from '@/stores/preferences';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', callback);
  return () => {
    media.removeEventListener('change', callback);
  };
}

/** Preferência do sistema; no servidor é desconhecida (null) para não divergir na hidratação. */
function useSystemDark(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DARK_QUERY).matches,
    () => null,
  );
}

/** Alterna claro/escuro (a opção "do sistema" fica nas configurações). */
export function ThemeToggle() {
  const t = useTranslations('shell.user');
  const theme = usePreferences((state) => state.theme);
  const systemDark = useSystemDark();
  const effective =
    theme === 'system' ? (systemDark === null ? null : systemDark ? 'dark' : 'light') : theme;
  const next = effective === 'dark' ? 'light' : 'dark';
  return (
    <IconButton
      label={`${t('theme')}: ${t(next)}`}
      icon={effective === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      onClick={() => {
        updatePreferences({ theme: next });
      }}
    />
  );
}
