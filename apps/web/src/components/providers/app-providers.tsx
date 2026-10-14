'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster, TooltipProvider } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

import { createQueryClient } from '@/lib/query/client';
import { applyPreferencesToDocument, preferencesStore, usePreferences } from '@/stores/preferences';

import { ServiceWorkerRegistration } from './service-worker';

/** Providers globais (client): cache de servidor, dicas, toasts e preferências visuais. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const theme = usePreferences((state) => state.theme);
  const t = useTranslations('common');

  useEffect(() => {
    applyPreferencesToDocument(preferencesStore.getState());
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      applyPreferencesToDocument(preferencesStore.getState());
    };
    media.addEventListener('change', sync);
    return () => {
      media.removeEventListener('change', sync);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster theme={theme} label={t('notifications')} closeLabel={t('close')} />
        <ServiceWorkerRegistration />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
