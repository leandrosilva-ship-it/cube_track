'use client';

import { Badge, Button, Dialog, EmptyState, IconButton, Skeleton, toast } from '@cube-track/ui';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { CatalogItem } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { CatalogItemDialog } from './catalog-item-dialog';
import { useCatalogItems, useDeactivateCatalogItem } from './hooks';

export interface CatalogPanelProps {
  contractId: string;
  canManage: boolean;
}

/** Catálogo de serviços (Código Edital) do contrato — base para as linhas de uma OS. */
export function CatalogPanel({ contractId, canManage }: CatalogPanelProps) {
  const t = useTranslations('contracts');
  const errorMessage = useErrorMessage();
  const items = useCatalogItems(contractId);
  const deactivate = useDeactivateCatalogItem(contractId);
  const [dialogItem, setDialogItem] = useState<'new' | CatalogItem | null>(null);

  const deactivateItem = async (id: string) => {
    try {
      await deactivate.mutateAsync(id);
      toast.success(t('catalog.deactivated'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (items.data === undefined) return <Skeleton className="h-32" />;

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDialogItem('new');
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('catalog.new')}
          </Button>
        </div>
      ) : null}

      {items.data.length === 0 ? (
        <EmptyState icon={<ClipboardList aria-hidden="true" />} title={t('catalog.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-xs text-fg-muted">
                <th className="px-3 py-2 text-start font-medium">{t('catalog.code')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('catalog.name')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('catalog.defaultUst')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('catalog.unit')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('catalog.statusColumn')}</th>
                {canManage ? <th className="px-3 py-2" aria-hidden="true" /> : null}
              </tr>
            </thead>
            <tbody>
              {items.data.map((item) => (
                <tr key={item.id} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{item.code}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2 tabular-nums">{Number(item.defaultUst).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2">{item.unit}</td>
                  <td className="px-3 py-2">
                    <Badge tone={item.isActive ? 'success' : 'neutral'}>
                      {item.isActive ? t('catalog.active') : t('catalog.inactive')}
                    </Badge>
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <IconButton
                          label={t('catalog.edit')}
                          icon={<Pencil className="size-4" aria-hidden="true" />}
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDialogItem(item);
                          }}
                        />
                        {item.isActive ? (
                          <IconButton
                            label={t('catalog.deactivate')}
                            icon={<Trash2 className="size-4" aria-hidden="true" />}
                            size="sm"
                            variant="ghost"
                            onClick={() => void deactivateItem(item.id)}
                          />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dialogItem !== null} onOpenChange={(open) => { if (!open) setDialogItem(null); }}>
        {dialogItem !== null ? (
          <CatalogItemDialog
            contractId={contractId}
            {...(dialogItem !== 'new' ? { item: dialogItem } : {})}
            onClose={() => {
              setDialogItem(null);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
