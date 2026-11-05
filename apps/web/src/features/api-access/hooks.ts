'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { ApiToken, ApiTokenWithSecret, OAuthApp, OAuthAppWithSecret } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

/**
 * API pública (ADR 0056): tokens pessoais (autosserviço, `qk.apiTokensMine`), tokens de qualquer
 * usuário do tenant (`api_tokens.manage`, `qk.apiTokensAll`) e apps OAuth do tenant — mesmo padrão de
 * TanStack Query + `qk.*` das demais features (ver `features/webhooks/hooks.ts`).
 */

// ------------------------------------------------------------------------------ tokens pessoais ---

export function useMyApiTokens() {
  return useQuery({
    queryKey: qk.apiTokensMine(),
    queryFn: () => api<{ data: ApiToken[] }>('/v1/me/tokens').then((response) => response.data),
  });
}

export interface CreateApiTokenInput {
  name: string;
  scopes: string[];
  expiresAt?: string | null;
}

export function useCreateMyApiToken() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: CreateApiTokenInput) =>
      api<ApiTokenWithSecret>('/v1/me/tokens', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.apiTokensMine() }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useRevokeMyApiToken() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/me/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.apiTokensMine() }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

// ----------------------------------------------------------------- administração (api_tokens.manage) ---

export function useAllApiTokens() {
  return useQuery({
    queryKey: qk.apiTokensAll(),
    queryFn: () => api<{ data: ApiToken[] }>('/v1/tokens').then((response) => response.data),
  });
}

export function useRevokeAnyApiToken() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.apiTokensAll() }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

// ------------------------------------------------------------------------------------ apps OAuth ---

export function useOAuthApps() {
  return useQuery({
    queryKey: qk.oauthApps(),
    queryFn: () => api<{ data: OAuthApp[] }>('/v1/oauth-apps').then((response) => response.data),
  });
}

export interface OAuthAppInput {
  name: string;
  description?: string;
  scopes: string[];
}

export function useCreateOAuthApp() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: OAuthAppInput) =>
      api<OAuthAppWithSecret>('/v1/oauth-apps', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.oauthApps() }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export interface UpdateOAuthAppInput {
  name?: string;
  description?: string | null;
  scopes?: string[];
  isActive?: boolean;
}

export function useUpdateOAuthApp() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateOAuthAppInput }) =>
      api<OAuthApp>(`/v1/oauth-apps/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.oauthApps() }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}

export function useDeleteOAuthApp() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/oauth-apps/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.oauthApps() }),
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });
}
