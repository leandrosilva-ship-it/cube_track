'use client';

import { Tooltip, cn } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import { useRealtime } from '@/realtime/store';

/** Ponto de status da conexão realtime (texto acessível + região viva para mudanças). */
export function ConnectionIndicator({ className }: { className?: string }) {
  const t = useTranslations('shell.connection');
  const status = useRealtime((state) => state.status);
  const label =
    status === 'online' ? t('online') : status === 'offline' ? t('offline') : t('connecting');
  return (
    <Tooltip content={label} side="right">
      <span
        className={cn('relative flex size-6 items-center justify-center', className)}
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2.5 rounded-full',
            status === 'online' && 'bg-success',
            status === 'offline' && 'bg-danger',
            (status === 'connecting' || status === 'idle') && 'animate-pulse bg-warning',
          )}
        />
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  );
}
