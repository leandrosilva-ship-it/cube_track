import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/errors';

/** Política padrão: dados "frescos" por 30 s (o realtime mantém o cache atualizado entre refetches). */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Erros do cliente (403/404/422) não melhoram com retentativa.
          if (error instanceof ApiError && error.status < 500 && error.status !== 429) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}
