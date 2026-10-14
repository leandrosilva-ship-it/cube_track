'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useRouter } from '@/i18n/navigation';
import type { SessionResponse } from '@/lib/api/types';
import { establishSession } from '@/lib/auth/session';

import { authApi } from './api';
import { safeNextPath } from './next-path';

/**
 * Conclui o login: guarda a sessão, limpa o cache do usuário anterior e decide o destino —
 * seleção de organização quando houver mais de uma (e nenhum destino explícito).
 */
export function useCompleteSignIn() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(
    async (session: SessionResponse, rawNext: string | null) => {
      queryClient.clear();
      establishSession(session);
      const next = safeNextPath(rawNext);
      if (rawNext === null) {
        try {
          const { data } = await authApi.organizations();
          if (data.length > 1) {
            router.replace(`/organizations?next=${encodeURIComponent(next)}`);
            return;
          }
        } catch {
          // Sem a lista, segue para o destino padrão.
        }
      }
      router.replace(next);
    },
    [queryClient, router],
  );
}
