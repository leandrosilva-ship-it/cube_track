'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api/client';
import type {
  CatalogItem,
  Contract,
  CreateCatalogItemInput,
  CreateContractInput,
  CreateInvoiceInput,
  GenerateMeasurementInput,
  Invoice,
  InvoiceStatus,
  Measurement,
  UpdateCatalogItemInput,
  UpdateContractInput,
  UpdateInvoiceInput,
  UpdateMeasurementInput,
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
