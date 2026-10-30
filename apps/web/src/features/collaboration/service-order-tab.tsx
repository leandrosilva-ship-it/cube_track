'use client';

import { Button, EmptyState, Skeleton } from '@cube-track/ui';
import { ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Item } from '@/lib/api/types';

import { useCreateServiceOrderForItem, useServiceOrderForItem } from '../contracts/hooks';
import { ServiceOrderCreateForm } from '../contracts/service-order-create-form';
import { ServiceOrderDetail } from '../contracts/service-order-detail';

export interface ServiceOrderTabProps {
  item: Item;
  contractId: string;
  canManage: boolean;
}

/**
 * Aba "OS/UST" do Painel do Item (ADR 0054) — só montada pelo `ItemPanel` quando o board do item
 * está vinculado a um contrato. Um item só pode ter uma OS (`GET /items/:itemId/service-order`
 * devolve `null` quando ainda não existe uma); o saldo do contrato nunca é recalculado aqui.
 */
export function ServiceOrderTab({ item, contractId, canManage }: ServiceOrderTabProps) {
  const t = useTranslations('contracts');
  const serviceOrder = useServiceOrderForItem(item.id);
  const create = useCreateServiceOrderForItem(item.id);
  const [creating, setCreating] = useState(false);

  if (serviceOrder.data === undefined) return <Skeleton className="h-32" />;

  if (serviceOrder.data === null) {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState icon={<ClipboardList aria-hidden="true" />} title={t('serviceOrders.itemEmpty')} />
        {canManage ? (
          creating ? (
            <ServiceOrderCreateForm
              onSubmit={(input) => create.mutateAsync(input)}
              pending={create.isPending}
              onCreated={() => {
                setCreating(false);
              }}
              onCancel={() => {
                setCreating(false);
              }}
            />
          ) : (
            <Button
              size="sm"
              onClick={() => {
                setCreating(true);
              }}
            >
              {t('serviceOrders.itemCreate')}
            </Button>
          )
        ) : null}
      </div>
    );
  }

  return <ServiceOrderDetail order={serviceOrder.data} contractId={contractId} canManage={canManage} />;
}
