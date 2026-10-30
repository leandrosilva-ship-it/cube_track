'use client';

import { Badge, Button, EmptyState, Modal, Skeleton } from '@cube-track/ui';
import { ArrowLeft, ClipboardList, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail, ServiceOrder } from '@/lib/api/types';

import { useCreateServiceOrderForBoard, useServiceOrdersForBoard } from './hooks';
import { serviceOrderStatusTone } from './model';
import { ServiceOrderCreateForm } from './service-order-create-form';
import { ServiceOrderDetail } from './service-order-detail';

export interface ServiceOrdersDialogProps {
  board: BoardDetail;
}

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'detail'; id: string };

/**
 * Ordens de Serviço de um board vinculado a contrato (ADR 0054): lista, cria OS avulsa (sem item) e
 * abre o detalhe para editar linhas/transicionar status. Só é renderizado quando `board.contractId`
 * não é `null` — quem decide isso é o chamador (`BoardHeader`).
 */
export function ServiceOrdersDialog({ board }: ServiceOrdersDialogProps) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const orders = useServiceOrdersForBoard(board.id);
  const create = useCreateServiceOrderForBoard(board.id);
  const [view, setView] = useState<View>({ kind: 'list' });
  const canManage = board.permissions.includes('board.manage');
  const contractId = board.contractId;

  if (contractId === null) return null;

  const backToList = () => {
    setView({ kind: 'list' });
  };

  if (view.kind === 'detail') {
    const order = (orders.data ?? []).find((candidate) => candidate.id === view.id);
    return (
      <Modal title={order?.number ?? t('serviceOrders.dialogTitle')} closeLabel={tc('close')} className="max-w-2xl">
        <div className="-mt-2 mb-3">
          <Button variant="ghost" size="sm" onClick={backToList}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {t('serviceOrders.backToList')}
          </Button>
        </div>
        {order === undefined ? (
          <Skeleton className="h-32" />
        ) : (
          <ServiceOrderDetail order={order} contractId={contractId} canManage={canManage} onDeleted={backToList} />
        )}
      </Modal>
    );
  }

  if (view.kind === 'new') {
    return (
      <Modal title={t('serviceOrders.newTitle')} closeLabel={tc('close')} className="max-w-lg">
        <ServiceOrderCreateForm
          onSubmit={(input) => create.mutateAsync(input)}
          pending={create.isPending}
          onCreated={(order: ServiceOrder) => {
            setView({ kind: 'detail', id: order.id });
          }}
          onCancel={backToList}
        />
      </Modal>
    );
  }

  return (
    <Modal title={t('serviceOrders.dialogTitle')} closeLabel={tc('close')} className="max-w-2xl">
      <div className="flex flex-col gap-3">
        {canManage ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setView({ kind: 'new' });
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('serviceOrders.new')}
            </Button>
          </div>
        ) : null}

        {orders.data === undefined ? (
          <Skeleton className="h-32" />
        ) : orders.data.length === 0 ? (
          <EmptyState icon={<ClipboardList aria-hidden="true" />} title={t('serviceOrders.empty')} />
        ) : (
          <ul className="flex flex-col gap-2">
            {orders.data.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-start hover:bg-surface-hover"
                  onClick={() => {
                    setView({ kind: 'detail', id: order.id });
                  }}
                >
                  <span className="font-mono text-sm font-semibold">{order.number}</span>
                  <Badge tone={serviceOrderStatusTone(order.status)}>{t(`serviceOrders.status.${order.status}`)}</Badge>
                  {order.itemId !== null ? (
                    <span className="text-xs text-fg-subtle">{t('serviceOrders.linkedToItem')}</span>
                  ) : null}
                  <span className="ms-auto text-xs text-fg-muted">
                    {t('serviceOrders.totalUst')}: {Number(order.totalUst).toLocaleString('pt-BR')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
