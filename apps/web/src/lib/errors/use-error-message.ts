'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { ApiError, NetworkError } from '@/lib/api/errors';

/** Traduz erros da API/rede em mensagens para o usuário. */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown) => {
      if (error instanceof NetworkError) return t('network');
      if (!(error instanceof ApiError)) return t('generic');
      switch (error.status) {
        case 401:
          return t('sessionExpired');
        case 403:
          return t('forbidden');
        case 404:
          return t('notFound');
        case 409:
          return t('conflict');
        case 400:
        case 422:
          return error.problem.errors === undefined
            ? (error.problem.detail ?? t('validation'))
            : t('validation');
        case 429:
          return t('rateLimited', { seconds: error.problem.retryAfter ?? 60 });
        default:
          return t('generic');
      }
    },
    [t],
  );
}
