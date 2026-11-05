'use client';

import { toast } from '@cube-track/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  BackgroundImportJob,
  BackgroundImportSource,
  ImportMapping,
  ImportPreviewResponse,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';

/**
 * Importação em background (ADR 0056): prévia → ajuste de mapeamento → commit (processa no worker) →
 * acompanhamento por polling (ou pelo evento realtime `import_job.changed`, ver `realtime/apply.ts`).
 */

export function usePreviewImport(boardId: string) {
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (input: { source: BackgroundImportSource; fileName: string; contentBase64: string }) =>
      api<ImportPreviewResponse>(`/v1/boards/${boardId}/imports/preview`, { method: 'POST', body: input }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdateImportMapping() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: ({ importJobId, mapping }: { importJobId: string; mapping: ImportMapping }) =>
      api<BackgroundImportJob>(`/v1/imports/${importJobId}/mapping`, { method: 'PATCH', body: { mapping } }),
    onSuccess: (job) => queryClient.setQueryData(qk.importJob(job.id), job),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useCommitImport() {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return useMutation({
    mutationFn: (importJobId: string) =>
      api<BackgroundImportJob>(`/v1/imports/${importJobId}/commit`, { method: 'POST' }),
    onSuccess: (job) => queryClient.setQueryData(qk.importJob(job.id), job),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

const ACTIVE_STATUSES = new Set(['uploaded', 'processing']);

/** Acompanha o job por polling (2 s) enquanto não terminar — o evento realtime `import_job.changed`
 * (ver `realtime/apply.ts`) também invalida esta mesma chave, então o polling é só o reforço/fallback. */
export function useImportJob(importJobId: string | null) {
  return useQuery({
    queryKey: qk.importJob(importJobId ?? 'none'),
    queryFn: () => api<BackgroundImportJob>(`/v1/imports/${importJobId ?? ''}`),
    enabled: importJobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || ACTIVE_STATUSES.has(status) ? 2_000 : false;
    },
  });
}
