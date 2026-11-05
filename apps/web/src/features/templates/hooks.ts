'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { Template, TemplateKind } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

/** Galeria de templates (ADR 0056): pública (global, só leitura) e interna (do tenant, CRUD com
 * `templates.manage`) — ver `docs/integrations.md` §3. */

export function usePublicTemplates() {
  return useQuery({
    queryKey: qk.templatesPublic(),
    queryFn: () => api<{ data: Template[] }>('/v1/templates', { query: { scope: 'public' } }).then((r) => r.data),
  });
}

export function useInternalTemplates() {
  return useQuery({
    queryKey: qk.templatesInternal(),
    queryFn: () => api<{ data: Template[] }>('/v1/templates', { query: { scope: 'internal' } }).then((r) => r.data),
  });
}

export interface TemplateInputBody {
  kind: TemplateKind;
  name: string;
  description?: string;
  category?: string;
  payload: Record<string, unknown>;
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: TemplateInputBody) => api<Template>('/v1/templates', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.templatesInternal() }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateTemplate() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<TemplateInputBody, 'kind'>> }) =>
      api<Template>(`/v1/templates/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.templatesInternal() }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.templatesInternal() }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useApplyTemplate() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<{ kind: TemplateKind; created: Record<string, unknown> }>(`/v1/templates/${id}/apply`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.workspaces() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export interface SaveBoardAsTemplateInput {
  name: string;
  description?: string;
  category?: string;
  includeItems: boolean;
}

export function useSaveBoardAsTemplate(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: SaveBoardAsTemplateInput) =>
      api<Template>(`/v1/boards/${boardId}/save-as-template`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.templatesInternal() }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
