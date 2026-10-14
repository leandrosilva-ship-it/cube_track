'use client';

import { toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/** Registra o service worker (PWA) em produção e avisa quando houver nova versão. */
export function ServiceWorkerRegistration() {
  const t = useTranslations('pwa');

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((registration) => {
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (
            cancelled ||
            installing.state !== 'installed' ||
            navigator.serviceWorker.controller === null
          )
            return;
          toast(t('updateAvailable'), {
            duration: Infinity,
            action: {
              label: t('reload'),
              onClick: () => {
                installing.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              },
            },
          });
        });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return null;
}
