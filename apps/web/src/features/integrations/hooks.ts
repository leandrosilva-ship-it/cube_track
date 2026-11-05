'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { DevEventLink, ExternalFileLink, IntegrationConnection } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

/** Integrações de terceiros (ADR 0056) — conexões por workspace, vínculos de dev-events (somente
 * leitura) e arquivos externos do Drive/OneDrive por referência. */

export function useWorkspaceIntegrations(workspaceId: string) {
  return useQuery({
    queryKey: qk.integrationsOfWorkspace(workspaceId),
    queryFn: () =>
      api<{ data: IntegrationConnection[] }>(`/v1/workspaces/${workspaceId}/integrations`).then((r) => r.data),
    retry: false,
  });
}

export function useDisconnectIntegration(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (connectionId: string) => api<undefined>(`/v1/integrations/${connectionId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.integrationsOfWorkspace(workspaceId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Google/Microsoft (OAuth, BYOK): registra o app do tenant e devolve a URL de autorização — o
 * chamador faz a navegação de página inteira (`window.location.href`), nunca um fetch. */
export function useConnectOAuthProvider(workspaceId: string, provider: 'google' | 'microsoft') {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { clientId: string; clientSecret: string; emailToItemEnabled: boolean }) =>
      api<{ authorizationUrl: string }>(`/v1/workspaces/${workspaceId}/integrations/${provider}/connect`, {
        method: 'POST',
        body: input,
      }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useConnectSlack(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { incomingWebhookUrl: string; signingSecret: string; defaultBoardId?: string }) =>
      api<undefined>(`/v1/workspaces/${workspaceId}/integrations/slack/connect`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.integrationsOfWorkspace(workspaceId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useConnectTeams(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { incomingWebhookUrl: string }) =>
      api<undefined>(`/v1/workspaces/${workspaceId}/integrations/teams/connect`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.integrationsOfWorkspace(workspaceId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useConnectDevWebhook(workspaceId: string, provider: 'github' | 'gitlab') {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { webhookSecret: string }) =>
      api<undefined>(`/v1/workspaces/${workspaceId}/integrations/${provider}/connect`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.integrationsOfWorkspace(workspaceId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useConnectAzureDevOps(workspaceId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { username: string; password: string }) =>
      api<undefined>(`/v1/workspaces/${workspaceId}/integrations/azure-devops/connect`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.integrationsOfWorkspace(workspaceId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ------------------------------------------------------------------------- item panel (somente leitura) ---

export function useDevEvents(itemId: string) {
  return useQuery({
    queryKey: qk.devEvents(itemId),
    queryFn: () => api<{ data: DevEventLink[] }>(`/v1/items/${itemId}/dev-events`).then((r) => r.data),
  });
}

export function useExternalFiles(itemId: string) {
  return useQuery({
    queryKey: qk.externalFiles(itemId),
    queryFn: () => api<{ data: ExternalFileLink[] }>(`/v1/items/${itemId}/external-files`).then((r) => r.data),
  });
}

export function useLinkExternalFile(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { connectionId: string; externalFileId: string }) =>
      api<ExternalFileLink>(`/v1/items/${itemId}/external-files`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.externalFiles(itemId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUnlinkExternalFile(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/external-files/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.externalFiles(itemId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
