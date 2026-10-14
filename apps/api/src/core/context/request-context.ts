import { AsyncLocalStorage } from 'node:async_hooks';

import type { RealtimeTransportMessage } from '@cube-track/shared';
import type { Transaction } from '@cube-track/db';

/** Usuário autenticado na requisição (derivado do access token). */
export interface AuthPrincipal {
  userId: string;
  tenantId: string;
  sessionId: string;
  kind: 'member' | 'guest';
}

export interface ResolvedTenant {
  tenantId: string;
  slug: string;
  source: 'header' | 'subdomain';
}

/** Mudança registrada por um caso de uso (vira auditoria e log de atividade na mesma transação). */
export interface ChangeRecord {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
  boardId?: string | null;
  itemId?: string | null;
  /** Linhas do log de atividade do item (visível ao usuário). */
  activity?: {
    action: string;
    columnKey?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  }[];
  metadata?: Record<string, unknown>;
}

export interface RequestContextStore {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  tenant: ResolvedTenant | null;
  principal: AuthPrincipal | null;
  tx: Transaction | null;
  changes: ChangeRecord[];
  /** Mensagens realtime a publicar após o commit. */
  published: RealtimeTransportMessage[];
  /** Ações executadas somente após o commit (ex.: invalidar caches). */
  afterCommit: (() => Promise<void>)[];
  clientMutationId: string | null;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export function createContextStore(
  partial: Partial<RequestContextStore> & { requestId: string },
): RequestContextStore {
  return {
    ip: null,
    userAgent: null,
    tenant: null,
    principal: null,
    tx: null,
    changes: [],
    published: [],
    afterCommit: [],
    clientMutationId: null,
    ...partial,
  };
}

export function runWithContext<T>(store: RequestContextStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function currentContext(): RequestContextStore | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContextStore {
  const store = storage.getStore();
  if (store === undefined) throw new Error('Contexto de requisição ausente');
  return store;
}
