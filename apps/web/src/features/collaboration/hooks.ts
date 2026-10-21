'use client';

import { toast } from '@cube-track/ui';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import type {
  ActivityActor,
  ActivityLogEntry,
  ApprovalRequest,
  AttachmentSummary,
  AttachmentVersion,
  Checklist,
  FollowStatus,
  Item,
  ItemReply,
  ItemUpdate,
  Page,
  UpdateFeed,
} from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk, type ActivityFilters } from '@/lib/query/keys';

/**
 * Dados do painel do item (ADR 0048): leitura via React Query (chaves `qk.*`), sincronizadas por
 * eventos realtime em `@/realtime/apply`. Escritas invalidam a chave correspondente — o volume de
 * mutações aqui (postar, reagir, marcar) é baixo o bastante para dispensar o cache otimista pesado
 * usado pela grade de valores.
 */

// ---------------------------------------------------------------------------------- item ---

export function useItemDetail(itemId: string | null) {
  return useQuery({
    queryKey: qk.item(itemId ?? 'none'),
    queryFn: () => api<Item>(`/v1/items/${itemId ?? ''}`),
    enabled: itemId !== null,
    retry: (count, error) => !isApiError(error, 404) && !isApiError(error, 403) && count < 2,
  });
}

// ------------------------------------------------------------------------------- updates ---

export function useUpdatesFeed(itemId: string) {
  return useQuery({
    queryKey: qk.updates(itemId),
    queryFn: () => api<UpdateFeed>(`/v1/items/${itemId}/updates`, { query: { limit: 50 } }),
  });
}

export function useReplies(updateId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.replies(updateId),
    queryFn: () => api<{ data: ItemReply[] }>(`/v1/updates/${updateId}/replies`).then((r) => r.data),
    enabled,
  });
}

function invalidateUpdates(queryClient: QueryClient, itemId: string) {
  void queryClient.invalidateQueries({ queryKey: qk.updates(itemId) });
}

export function usePostUpdate(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      await api<ItemUpdate>(`/v1/items/${itemId}/updates`, { method: 'POST', body: { body } });
      invalidateUpdates(queryClient, itemId);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };
}

export function useEditUpdate(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (updateId: string, body: Record<string, unknown>): Promise<boolean> => {
    try {
      await api<ItemUpdate>(`/v1/updates/${updateId}`, { method: 'PATCH', body: { body } });
      invalidateUpdates(queryClient, itemId);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };
}

export function useDeleteUpdate(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (updateId: string): Promise<void> => {
    try {
      await api(`/v1/updates/${updateId}`, { method: 'DELETE' });
      invalidateUpdates(queryClient, itemId);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}

export function usePinUpdate(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (updateId: string, pinned: boolean): Promise<void> => {
    try {
      await api(`/v1/updates/${updateId}/pin`, { method: 'POST', body: { pinned } });
      invalidateUpdates(queryClient, itemId);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}

export function usePostReply(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (updateId: string, body: Record<string, unknown>): Promise<boolean> => {
    try {
      await api<ItemReply>(`/v1/updates/${updateId}/replies`, { method: 'POST', body: { body } });
      void queryClient.invalidateQueries({ queryKey: qk.replies(updateId) });
      invalidateUpdates(queryClient, itemId);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };
}

export function useEditReply(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (reply: ItemReply, body: Record<string, unknown>): Promise<boolean> => {
    try {
      await api<ItemReply>(`/v1/replies/${reply.id}`, { method: 'PATCH', body: { body } });
      void queryClient.invalidateQueries({ queryKey: qk.replies(reply.updateId) });
      invalidateUpdates(queryClient, itemId);
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };
}

export function useDeleteReply(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (reply: ItemReply): Promise<void> => {
    try {
      await api(`/v1/replies/${reply.id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: qk.replies(reply.updateId) });
      invalidateUpdates(queryClient, itemId);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}

export function useToggleReaction(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (target: { type: 'update' | 'reply'; id: string; updateId?: string }, emoji: string) => {
    try {
      await api(`/v1/${target.type}s/${target.id}/reactions`, { method: 'POST', body: { emoji } });
      if (target.type === 'reply' && target.updateId !== undefined)
        void queryClient.invalidateQueries({ queryKey: qk.replies(target.updateId) });
      invalidateUpdates(queryClient, itemId);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}

// ------------------------------------------------------------------------------- atividade ---

export function useActivityActors(itemId: string) {
  return useQuery({
    queryKey: qk.activityActors(itemId),
    queryFn: () => api<{ data: ActivityActor[] }>(`/v1/items/${itemId}/activity/actors`).then((r) => r.data),
  });
}

export function useActivityLog(itemId: string, filters: ActivityFilters) {
  return useQuery({
    queryKey: qk.activity(itemId, filters),
    queryFn: () =>
      api<Page<ActivityLogEntry>>(`/v1/items/${itemId}/activity`, {
        query: { limit: 50, ...filters },
      }),
  });
}

// ------------------------------------------------------------------------------ checklists ---

export function useChecklists(itemId: string) {
  return useQuery({
    queryKey: qk.checklists(itemId),
    queryFn: () => api<{ data: Checklist[] }>(`/v1/items/${itemId}/checklists`).then((r) => r.data),
  });
}

function invalidateChecklists(queryClient: QueryClient, itemId: string) {
  void queryClient.invalidateQueries({ queryKey: qk.checklists(itemId) });
}

export function useChecklistActions(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const guard = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
        invalidateChecklists(queryClient, itemId);
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
    [queryClient, itemId, errorMessage],
  );
  return useMemo(
    () => ({
      createChecklist: (title: string) =>
        guard(() => api(`/v1/items/${itemId}/checklists`, { method: 'POST', body: { title } })),
      renameChecklist: (checklistId: string, title: string) =>
        guard(() => api(`/v1/checklists/${checklistId}`, { method: 'PATCH', body: { title } })),
      deleteChecklist: (checklistId: string) =>
        guard(() => api(`/v1/checklists/${checklistId}`, { method: 'DELETE' })),
      addItem: (checklistId: string, content: string) =>
        guard(() => api(`/v1/checklists/${checklistId}/items`, { method: 'POST', body: { content } })),
      toggleItem: (itemRowId: string, isDone: boolean) =>
        guard(() => api(`/v1/checklist-items/${itemRowId}`, { method: 'PATCH', body: { isDone } })),
      renameItem: (itemRowId: string, content: string) =>
        guard(() => api(`/v1/checklist-items/${itemRowId}`, { method: 'PATCH', body: { content } })),
      deleteItem: (itemRowId: string) =>
        guard(() => api(`/v1/checklist-items/${itemRowId}`, { method: 'DELETE' })),
    }),
    [itemId, guard],
  );
}

// ----------------------------------------------------------------------------------- seguir ---

export function useFollowStatus(itemId: string) {
  return useQuery({
    queryKey: qk.follow(itemId),
    queryFn: () => api<FollowStatus>(`/v1/items/${itemId}/follow`),
  });
}

export function useSetFollowing(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (following: boolean) => {
    try {
      await api(`/v1/items/${itemId}/follow`, { method: 'POST', body: { following } });
      void queryClient.invalidateQueries({ queryKey: qk.follow(itemId) });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}

// -------------------------------------------------------------------------------- aprovações ---

export function useApprovals(itemId: string) {
  return useQuery({
    queryKey: qk.approvals(itemId),
    queryFn: () => api<{ data: ApprovalRequest[] }>(`/v1/items/${itemId}/approvals`).then((r) => r.data),
  });
}

export function useApprovalActions(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const guard = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
        void queryClient.invalidateQueries({ queryKey: qk.approvals(itemId) });
        return true;
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      }
    },
    [queryClient, itemId, errorMessage],
  );
  return useMemo(
    () => ({
      request: (input: { approverIds: string[]; mode: 'all' | 'any'; note?: string }) =>
        guard(() => api(`/v1/items/${itemId}/approvals`, { method: 'POST', body: input })),
      decide: (requestId: string, decision: 'approved' | 'rejected', comment?: string) =>
        guard(() => api(`/v1/approvals/${requestId}/decide`, { method: 'POST', body: { decision, comment } })),
      cancel: (requestId: string) =>
        guard(() => api(`/v1/approvals/${requestId}/cancel`, { method: 'POST' })),
    }),
    [itemId, guard],
  );
}

// ------------------------------------------------------------------------------------ arquivos ---

export function useItemFiles(itemId: string) {
  return useQuery({
    queryKey: qk.itemFiles(itemId),
    queryFn: () => api<{ data: AttachmentSummary[] }>(`/v1/items/${itemId}/files`).then((r) => r.data),
  });
}

export function useFileVersions(attachmentId: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.fileVersions(attachmentId),
    queryFn: () =>
      api<{ data: AttachmentVersion[] }>(`/v1/files/${attachmentId}/versions`).then((r) => r.data),
    enabled,
  });
}

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface UploadTarget {
  boardId: string;
  itemId: string;
  /** Presente ao enviar uma nova versão de um anexo existente. */
  attachmentId?: string;
}

export function useUploadFile(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (target: UploadTarget, file: File): Promise<boolean> => {
    try {
      const checksumSha256 = await sha256Hex(file);
      const request = await api<{
        attachmentId: string;
        versionId: string;
        upload: { url: string; method: 'PUT'; headers: Record<string, string> };
      }>('/v1/files/uploads', {
        method: 'POST',
        body: {
          boardId: target.boardId,
          itemId: target.itemId,
          ...(target.attachmentId === undefined ? {} : { attachmentId: target.attachmentId }),
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          checksumSha256,
        },
      });
      const put = await fetch(request.upload.url, {
        method: 'PUT',
        headers: request.upload.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`Falha no envio ao armazenamento (${String(put.status)}).`);
      await api(`/v1/files/${request.attachmentId}/versions/${request.versionId}/complete`, {
        method: 'POST',
      });
      void queryClient.invalidateQueries({ queryKey: qk.itemFiles(itemId) });
      if (target.attachmentId !== undefined)
        void queryClient.invalidateQueries({ queryKey: qk.fileVersions(target.attachmentId) });
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  };
}

export function useDownloadFile() {
  const errorMessage = useErrorMessage();
  return async (attachmentId: string, version?: number): Promise<void> => {
    try {
      const path =
        version === undefined
          ? `/v1/files/${attachmentId}/download-url`
          : `/v1/files/${attachmentId}/versions/${String(version)}/download-url`;
      const { url } = await api<{ url: string }>(path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}

export function useDeleteFile(itemId: string) {
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  return async (attachmentId: string): Promise<void> => {
    try {
      await api(`/v1/files/${attachmentId}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: qk.itemFiles(itemId) });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
}
