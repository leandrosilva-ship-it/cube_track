'use client';

import type { FilterGroup } from '@cube-track/shared';
import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type { FormDefinition, FormField, PublicFormDefinition } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

// -------------------------------------------------------------------------------- formulários ---

export function useForms(boardId: string) {
  return useQuery({
    queryKey: qk.forms(boardId),
    queryFn: async ({ signal }) =>
      (await api<{ data: FormDefinition[] }>(`/v1/boards/${boardId}/forms`, { signal })).data,
  });
}

export function useForm(formId: string | null) {
  return useQuery({
    queryKey: qk.form(formId ?? 'none'),
    enabled: formId !== null,
    queryFn: ({ signal }) => api<FormDefinition>(`/v1/forms/${formId}`, { signal }),
  });
}

export interface CreateFormInput {
  name: string;
  description?: string | null;
  targetGroupId?: string | null;
}

export function useCreateForm(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: CreateFormInput) =>
      api<FormDefinition>(`/v1/boards/${boardId}/forms`, { method: 'POST', body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.forms(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export interface UpdateFormInput {
  name?: string;
  description?: string | null;
  targetGroupId?: string | null;
  requiresLogin?: boolean;
  isActive?: boolean;
  closesAt?: string | null;
  settings?: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    thankYouMessage?: string | null;
    redirectUrl?: string | null;
  };
}

export function useUpdateForm(formId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: UpdateFormInput) =>
      api<FormDefinition>(`/v1/forms/${formId}`, { method: 'PATCH', body: input }),
    onSuccess: (form) => {
      queryClient.setQueryData(qk.form(formId), form);
      void queryClient.invalidateQueries({ queryKey: qk.forms(form.boardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeleteForm(boardId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (formId: string) => api<undefined>(`/v1/forms/${formId}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.forms(boardId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useSetFormPublic(formId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (isPublic: boolean) =>
      api<{ form: FormDefinition; token: string | null }>(`/v1/forms/${formId}/public-link`, {
        method: 'POST',
        body: { isPublic },
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(qk.form(formId), result.form);
      void queryClient.invalidateQueries({ queryKey: qk.forms(result.form.boardId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// -------------------------------------------------------------------------------------- campos ---

export function useFormFields(formId: string | null) {
  return useQuery({
    queryKey: qk.formFields(formId ?? 'none'),
    enabled: formId !== null,
    queryFn: async ({ signal }) =>
      (await api<{ data: FormField[] }>(`/v1/forms/${formId}/fields`, { signal })).data,
  });
}

export interface FormFieldInput {
  columnKey?: string | null;
  label?: string;
  helpText?: string | null;
  fieldType?: string;
  isRequired?: boolean;
  showWhen?: FilterGroup | null;
  settings?: Record<string, unknown>;
  position?: { afterId?: string; beforeId?: string };
}

export function useAddFormField(formId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: FormFieldInput) =>
      api<FormField>(`/v1/forms/${formId}/fields`, { method: 'POST', body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.formFields(formId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateFormField(formId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: FormFieldInput }) =>
      api<FormField>(`/v1/form-fields/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.formFields(formId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useRemoveFormField(formId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/form-fields/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.formFields(formId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ----------------------------------------------------------------------------------- envio ---

export function usePublicForm(token: string) {
  return useQuery({
    queryKey: qk.publicForm(token),
    queryFn: ({ signal }) => api<PublicFormDefinition>(`/v1/public/forms/${token}`, { signal }),
    retry: false,
  });
}

export interface SubmitPublicInput {
  answers: Record<string, unknown>;
  honeypot?: string;
  captcha?: { token: string; answer: number };
}

export function useSubmitPublicForm(token: string) {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: SubmitPublicInput) =>
      api<{ itemId: string; branding: FormDefinition['settings'] }>(
        `/v1/public/forms/${token}/submit`,
        { method: 'POST', body: input },
      ),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useSubmitInternalForm(formId: string) {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (answers: Record<string, unknown>) =>
      api<{ itemId: string }>(`/v1/forms/${formId}/submit`, { method: 'POST', body: { answers } }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
