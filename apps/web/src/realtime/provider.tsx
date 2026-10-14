'use client';

import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { io } from 'socket.io-client';

import { signOut } from '@/lib/auth/session';
import { sessionStore, useSession } from '@/stores/session';

import { RealtimeClient } from './client';
import { isPendingMutation } from './pending';

const RealtimeContext = createContext<RealtimeClient | null>(null);

const NOTIFICATION_EVENT = 'ct:notification';

export const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:3001';

/** Conecta o cliente realtime enquanto houver sessão; reautentica o socket a cada refresh. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const t = useTranslations('inbox');
  const status = useSession((state) => state.status);
  const accessToken = useSession((state) => state.accessToken);
  // Notificações viram evento de janela: o toast usa o idioma atual sem recriar o cliente.
  useEffect(() => {
    const listener = (event: Event) => {
      toast(t('newNotification', { title: (event as CustomEvent<string>).detail }));
    };
    window.addEventListener(NOTIFICATION_EVENT, listener);
    return () => {
      window.removeEventListener(NOTIFICATION_EVENT, listener);
    };
  }, [t]);

  const client = useMemo(
    () =>
      status !== 'authenticated'
        ? null
        : new RealtimeClient(
            queryClient,
            () =>
              io(REALTIME_URL, {
                transports: ['websocket'],
                // Função: cada (re)conexão usa o access token mais recente.
                auth: (callback) => {
                  callback({ token: sessionStore.getState().accessToken ?? '' });
                },
                reconnectionDelay: 1_000,
                reconnectionDelayMax: 30_000,
                randomizationFactor: 0.5,
              }),
            {
              isOwnPendingMutation: isPendingMutation,
              onSessionRevoked: () => {
                void signOut();
              },
              onNotification: (title) => {
                window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: title }));
              },
            },
          ),
    [status, queryClient],
  );

  useEffect(() => {
    if (client === null) return undefined;
    client.start(sessionStore.getState().accessToken ?? '');
    return () => {
      client.stop();
    };
  }, [client]);

  useEffect(() => {
    if (client !== null && accessToken !== null) client.updateToken(accessToken);
  }, [client, accessToken]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeClient(): RealtimeClient | null {
  return useContext(RealtimeContext);
}

/** Assina o board (eventos + presença) enquanto o componente estiver montado. */
export function useBoardRealtime(
  boardId: string,
  seq: number | undefined,
  viewId: string | null,
): void {
  const client = useRealtimeClient();
  useEffect(() => {
    if (client === null) return undefined;
    return client.watchBoard(boardId, viewId === null ? {} : { viewId });
  }, [client, boardId, viewId]);
  useEffect(() => {
    if (client !== null && seq !== undefined) client.setBaseline(boardId, seq);
  }, [client, boardId, seq]);
}
