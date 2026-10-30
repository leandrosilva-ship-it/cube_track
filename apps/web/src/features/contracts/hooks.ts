'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  CatalogItem,
  Contract,
  CreateCatalogItemInput,
  CreateContractInput,
  CreateInvoiceInput,
  CreateServiceOrderInput,
  CreateServiceOrderItemInput,
  GenerateMeasurementInput,
  Invoice,
  InvoiceStatus,
  Measurement,
  ServiceOrder,
  ServiceOrderStatus,
  UpdateCatalogItemInput,
  UpdateContractInput,
  UpdateInvoiceInput,
  UpdateMeasurementInput,
  UpdateServiceOrderInput,
  UpdateServiceOrderItemInput,
} from '@/lib/api/types';
import { qk } from '@/lib/query/keys';

// -------------------------------------------------------------------------------- contratos ---

export function useContracts(workspaceId: string) {
  return useQuery({
    queryKey: qk.contractsOf(workspaceId),
    queryFn: ({ signal }) =>
      api<{ data: Contract[] }>(`/v1/workspaces/${workspaceId}/contracts`, { signal }).then((r) => r.data),
  });
}

export function useContract(id: string | undefined) {
  return useQuery({
    queryKey: qk.contract(id ?? 'none'),
    queryFn: ({ signal }) => api<Contract>(`/v1/contracts/${id}`, { signal }),
    enabled: id !== undefined,
  });
}

export function useCreateContract(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContractInput) =>
      api<Contract>(`/v1/workspaces/${workspaceId}/contracts`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.contractsOf(workspaceId) }),
  });
}

export function useUpdateContract(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContractInput }) =>
      api<Contract>(`/v1/contracts/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (contract) => {
      void queryClient.invalidateQueries({ queryKey: qk.contractsOf(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: qk.contract(contract.id) });
    },
  });
}

export function useDeleteContract(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/contracts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.contractsOf(workspaceId) }),
  });
}

// ---------------------------------------------------------------------------------- catálogo ---

export function useCatalogItems(contractId: string | undefined) {
  return useQuery({
    queryKey: qk.catalogOf(contractId ?? 'none'),
    queryFn: ({ signal }) =>
      api<{ data: CatalogItem[] }>(`/v1/contracts/${contractId}/catalog-items`, { signal }).then((r) => r.data),
    enabled: contractId !== undefined,
  });
}

export function useCreateCatalogItem(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCatalogItemInput) =>
      api<CatalogItem>(`/v1/contracts/${contractId}/catalog-items`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.catalogOf(contractId) }),
  });
}

export function useUpdateCatalogItem(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCatalogItemInput }) =>
      api<CatalogItem>(`/v1/catalog-items/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.catalogOf(contractId) }),
  });
}

export function useDeactivateCatalogItem(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/v1/catalog-items/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.catalogOf(contractId) }),
  });
}

// ---------------------------------------------------------------------------------- medições ---

export function useMeasurements(contractId: string | undefined) {
  return useQuery({
    queryKey: qk.measurementsOf(contractId ?? 'none'),
    queryFn: ({ signal }) =>
      api<{ data: Measurement[] }>(`/v1/contracts/${contractId}/measurements`, { signal }).then((r) => r.data),
    enabled: contractId !== undefined,
  });
}

export function useGenerateMeasurement(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateMeasurementInput) =>
      api<Measurement>(`/v1/contracts/${contractId}/measurements/generate`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.measurementsOf(contractId) }),
  });
}

export function useUpdateMeasurement(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMeasurementInput }) =>
      api<Measurement>(`/v1/measurements/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.measurementsOf(contractId) }),
  });
}

export function useDecideMeasurement(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: 'approved' | 'rejected'; notes?: string | null }) =>
      api<Measurement>(`/v1/measurements/${id}/decide`, { method: 'POST', body: { status, notes } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.measurementsOf(contractId) });
      // Aprovar/rejeitar não altera o saldo (só a OS aceita altera), mas o valor da fatura futura
      // depende da medição aprovada — invalidar o contrato mantém a tela de detalhe coerente.
      void queryClient.invalidateQueries({ queryKey: qk.contract(contractId) });
    },
  });
}

// ----------------------------------------------------------------------------------- faturas ---

export function useInvoices(contractId: string | undefined) {
  return useQuery({
    queryKey: qk.invoicesOf(contractId ?? 'none'),
    queryFn: ({ signal }) =>
      api<{ data: Invoice[] }>(`/v1/contracts/${contractId}/invoices`, { signal }).then((r) => r.data),
    enabled: contractId !== undefined,
  });
}

export function useCreateInvoice(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ measurementId, input }: { measurementId: string; input: CreateInvoiceInput }) =>
      api<Invoice>(`/v1/measurements/${measurementId}/invoice`, { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.invoicesOf(contractId) }),
  });
}

export function useUpdateInvoice(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateInvoiceInput }) =>
      api<Invoice>(`/v1/invoices/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.invoicesOf(contractId) }),
  });
}

export function useTransitionInvoice(contractId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: InvoiceStatus }) =>
      api<Invoice>(`/v1/invoices/${id}/transition`, { method: 'POST', body: { to } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.invoicesOf(contractId) }),
  });
}

// ------------------------------------------------------------------- ordens de serviço (OS) ---

/**
 * Uma OS carrega `contractId`/`boardId`/`itemId` — usamos a resposta para invalidar exatamente os
 * caches que ela pode ter afetado, sem o chamador precisar conhecer esse contexto de antemão.
 * O saldo do contrato (`qk.contract`) é sempre invalidado: ele só muda de verdade quando a OS entra
 * em um status que consome saldo (aceita em diante), mas invalidar sempre é barato e mantém a tela
 * de contrato coerente assim que o usuário voltar a ela.
 */
function invalidateServiceOrderCaches(
  queryClient: QueryClient,
  order: Pick<ServiceOrder, 'contractId' | 'boardId' | 'itemId'>,
): void {
  if (order.boardId !== null) void queryClient.invalidateQueries({ queryKey: qk.serviceOrdersOfBoard(order.boardId) });
  if (order.itemId !== null) void queryClient.invalidateQueries({ queryKey: qk.serviceOrderOfItem(order.itemId) });
  void queryClient.invalidateQueries({ queryKey: qk.contract(order.contractId) });
}

export function useServiceOrdersForBoard(boardId: string) {
  return useQuery({
    queryKey: qk.serviceOrdersOfBoard(boardId),
    queryFn: ({ signal }) =>
      api<{ data: ServiceOrder[] }>(`/v1/boards/${boardId}/service-orders`, { signal }).then((r) => r.data),
  });
}

/** `null` quando o item ainda não tem OS vinculada (resposta do backend, não "ainda carregando"). */
export function useServiceOrderForItem(itemId: string | undefined) {
  return useQuery({
    queryKey: qk.serviceOrderOfItem(itemId ?? 'none'),
    queryFn: ({ signal }) => api<ServiceOrder | null>(`/v1/items/${itemId}/service-order`, { signal }),
    enabled: itemId !== undefined,
  });
}

export function useCreateServiceOrderForBoard(boardId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceOrderInput) =>
      api<ServiceOrder>(`/v1/boards/${boardId}/service-orders`, { method: 'POST', body: input }),
    onSuccess: (order) => {
      invalidateServiceOrderCaches(queryClient, order);
    },
  });
}

export function useCreateServiceOrderForItem(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateServiceOrderInput) =>
      api<ServiceOrder>(`/v1/items/${itemId}/service-order`, { method: 'POST', body: input }),
    onSuccess: (order) => {
      invalidateServiceOrderCaches(queryClient, order);
    },
  });
}

export function useUpdateServiceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateServiceOrderInput }) =>
      api<ServiceOrder>(`/v1/service-orders/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (order) => {
      invalidateServiceOrderCaches(queryClient, order);
    },
  });
}

export function useTransitionServiceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, to }: { id: string; to: ServiceOrderStatus }) =>
      api<ServiceOrder>(`/v1/service-orders/${id}/transition`, { method: 'POST', body: { to } }),
    onSuccess: (order) => {
      invalidateServiceOrderCaches(queryClient, order);
    },
  });
}

export function useDeleteServiceOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; boardId: string | null; itemId: string | null }) =>
      api<undefined>(`/v1/service-orders/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) => {
      if (variables.boardId !== null)
        void queryClient.invalidateQueries({ queryKey: qk.serviceOrdersOfBoard(variables.boardId) });
      if (variables.itemId !== null)
        void queryClient.invalidateQueries({ queryKey: qk.serviceOrderOfItem(variables.itemId) });
    },
  });
}

export function useAddServiceOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ serviceOrderId, input }: { serviceOrderId: string; input: CreateServiceOrderItemInput }) =>
      api<ServiceOrder>(`/v1/service-orders/${serviceOrderId}/items`, { method: 'POST', body: input }),
    onSuccess: (order) => {
      invalidateServiceOrderCaches(queryClient, order);
    },
  });
}

export function useUpdateServiceOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateServiceOrderItemInput }) =>
      api<ServiceOrder>(`/v1/service-order-items/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (order) => {
      invalidateServiceOrderCaches(queryClient, order);
    },
  });
}

export function useRemoveServiceOrderItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<ServiceOrder>(`/v1/service-order-items/${id}`, { method: 'DELETE' }),
    onSuccess: (order) => {
      invalidateServiceOrderCaches(queryClient, order);
    },
  });
}
