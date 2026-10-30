'use client';

import { computeServiceOrderItemUst, isConsumingOrderStatus } from '@cube-track/shared';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Textarea,
  toast,
} from '@cube-track/ui';
import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { CatalogItem, ServiceOrder, ServiceOrderStatus } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useAddServiceOrderItem,
  useCatalogItems,
  useDeleteServiceOrder,
  useRemoveServiceOrderItem,
  useTransitionServiceOrder,
  useUpdateServiceOrder,
} from './hooks';
import { allowedServiceOrderTransitions, requiresOverrideReason, serviceOrderStatusTone } from './model';

export interface ServiceOrderDetailProps {
  order: ServiceOrder;
  contractId: string;
  canManage: boolean;
  /** Chamado após uma exclusão bem-sucedida (só possível com a OS em rascunho) — fecha a visão de detalhe. */
  onDeleted?: () => void;
}

/**
 * Detalhe de uma OS (ADR 0054): status + transições, metadados (SEI/responsável/datas) e linhas
 * (Código Edital × quantidade × UST). Reutilizado no diálogo de OS do board e na aba "OS/UST" do
 * Painel do Item — o saldo do contrato nunca é recalculado aqui, só refletido (`GET /contracts/:id`).
 */
export function ServiceOrderDetail({ order, contractId, canManage, onDeleted }: ServiceOrderDetailProps) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const update = useUpdateServiceOrder();
  const transition = useTransitionServiceOrder();
  const remove = useDeleteServiceOrder();

  const [editing, setEditing] = useState(false);
  const [seiProcess, setSeiProcess] = useState(order.seiProcess ?? '');
  const [requesterName, setRequesterName] = useState(order.requesterName ?? '');
  const [description, setDescription] = useState(order.description ?? '');
  const [startDate, setStartDate] = useState(order.startDate ?? '');
  const [plannedEndDate, setPlannedEndDate] = useState(order.plannedEndDate ?? '');

  const transitions = allowedServiceOrderTransitions(order.status);
  const locked = isConsumingOrderStatus(order.status) || order.status === 'cancelled';

  const startEdit = () => {
    setSeiProcess(order.seiProcess ?? '');
    setRequesterName(order.requesterName ?? '');
    setDescription(order.description ?? '');
    setStartDate(order.startDate ?? '');
    setPlannedEndDate(order.plannedEndDate ?? '');
    setEditing(true);
  };

  const saveMetadata = async () => {
    try {
      await update.mutateAsync({
        id: order.id,
        input: {
          seiProcess: seiProcess.trim() === '' ? null : seiProcess.trim(),
          requesterName: requesterName.trim() === '' ? null : requesterName.trim(),
          description: description.trim() === '' ? null : description.trim(),
          startDate: startDate === '' ? null : startDate,
          plannedEndDate: plannedEndDate === '' ? null : plannedEndDate,
        },
      });
      toast.success(t('serviceOrders.updated'));
      setEditing(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const doTransition = async (to: ServiceOrderStatus) => {
    try {
      await transition.mutateAsync({ id: order.id, to });
      toast.success(t('serviceOrders.transitioned'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const doDelete = async () => {
    if (!window.confirm(t('serviceOrders.deleteConfirm', { number: order.number }))) return;
    try {
      await remove.mutateAsync({ id: order.id, boardId: order.boardId, itemId: order.itemId });
      toast.success(t('serviceOrders.deleted'));
      onDeleted?.();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{order.number}</span>
        <Badge tone={serviceOrderStatusTone(order.status)}>{t(`serviceOrders.status.${order.status}`)}</Badge>
        <span className="text-xs text-fg-muted">
          {t('serviceOrders.totalUst')}: {Number(order.totalUst).toLocaleString('pt-BR')}
        </span>
      </div>

      {canManage && transitions.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('serviceOrders.transitionsLabel')}>
          {transitions.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === 'cancelled' ? 'ghost' : 'secondary'}
              loading={transition.isPending}
              onClick={() => void doTransition(to)}
            >
              {t(`serviceOrders.transitionTo.${to}`)}
            </Button>
          ))}
        </div>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
          <Field label={t('serviceOrders.seiProcess')}>
            <Input
              value={seiProcess}
              onChange={(event) => {
                setSeiProcess(event.target.value);
              }}
            />
          </Field>
          <Field label={t('serviceOrders.requesterName')}>
            <Input
              value={requesterName}
              onChange={(event) => {
                setRequesterName(event.target.value);
              }}
            />
          </Field>
          <Field label={t('serviceOrders.description')}>
            <Textarea
              value={description}
              rows={2}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('serviceOrders.startDate')}>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                }}
              />
            </Field>
            <Field label={t('serviceOrders.plannedEndDate')}>
              <Input
                type="date"
                value={plannedEndDate}
                onChange={(event) => {
                  setPlannedEndDate(event.target.value);
                }}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
              }}
            >
              {tc('cancel')}
            </Button>
            <Button size="sm" onClick={() => void saveMetadata()} loading={update.isPending}>
              {tc('save')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          {order.seiProcess !== null ? <span>{t('serviceOrders.seiProcess')}: {order.seiProcess}</span> : null}
          {order.requesterName !== null ? (
            <span>{t('serviceOrders.requesterName')}: {order.requesterName}</span>
          ) : null}
          {order.plannedEndDate !== null ? (
            <span>{t('serviceOrders.plannedEndDate')}: {order.plannedEndDate}</span>
          ) : null}
          {order.description !== null && order.description !== '' ? <p className="w-full">{order.description}</p> : null}
          {canManage ? (
            <Button variant="ghost" size="sm" onClick={startEdit}>
              <Pencil className="size-4" aria-hidden="true" />
              {t('serviceOrders.editMetadata')}
            </Button>
          ) : null}
        </div>
      )}

      <ServiceOrderLines order={order} contractId={contractId} canManage={canManage && !locked} />

      {canManage && order.status === 'draft' ? (
        <div>
          <Button variant="danger" size="sm" loading={remove.isPending} onClick={() => void doDelete()}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('serviceOrders.delete')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Linhas da OS (Código Edital × quantidade × UST) — bloqueadas quando a OS já consome saldo (aceita+) ou está cancelada. */
function ServiceOrderLines({
  order,
  contractId,
  canManage,
}: {
  order: ServiceOrder;
  contractId: string;
  canManage: boolean;
}) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const catalog = useCatalogItems(contractId);
  const addItem = useAddServiceOrderItem();
  const removeItem = useRemoveServiceOrderItem();

  const [adding, setAdding] = useState(false);
  const [catalogItemId, setCatalogItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [manualAdjust, setManualAdjust] = useState(false);
  const [ustUnit, setUstUnit] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const activeCatalog: CatalogItem[] = (catalog.data ?? []).filter((item) => item.isActive);
  const selectedCatalogItem = activeCatalog.find((item) => item.id === catalogItemId);
  const effectiveUstUnit = manualAdjust ? ustUnit : (selectedCatalogItem?.defaultUst ?? '');
  const needsReason =
    selectedCatalogItem !== undefined && manualAdjust && requiresOverrideReason(effectiveUstUnit, selectedCatalogItem.defaultUst);
  const previewTotal =
    selectedCatalogItem === undefined || quantity.trim() === '' || effectiveUstUnit.trim() === ''
      ? null
      : computeServiceOrderItemUst(Number(quantity), Number(effectiveUstUnit));
  const canSubmitLine =
    selectedCatalogItem !== undefined &&
    quantity.trim() !== '' &&
    (!manualAdjust || ustUnit.trim() !== '') &&
    (!needsReason || overrideReason.trim() !== '');

  const resetForm = () => {
    setCatalogItemId('');
    setQuantity('1');
    setManualAdjust(false);
    setUstUnit('');
    setOverrideReason('');
    setAdding(false);
  };

  const submitLine = async () => {
    if (selectedCatalogItem === undefined || !canSubmitLine) return;
    try {
      await addItem.mutateAsync({
        serviceOrderId: order.id,
        input: {
          catalogItemId: selectedCatalogItem.id,
          quantity: quantity.trim(),
          ...(manualAdjust ? { ustUnit: ustUnit.trim(), ustOverrideReason: overrideReason.trim() } : {}),
        },
      });
      toast.success(t('serviceOrders.lineAdded'));
      resetForm();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const doRemoveLine = async (id: string) => {
    if (!window.confirm(t('serviceOrders.removeLineConfirm'))) return;
    try {
      await removeItem.mutateAsync(id);
      toast.success(t('serviceOrders.lineRemoved'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase text-fg-subtle">{t('serviceOrders.lines')}</p>

      {order.items.length === 0 ? (
        <EmptyState icon={<ClipboardList aria-hidden="true" />} title={t('serviceOrders.linesEmpty')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-xs text-fg-muted">
                <th className="px-3 py-2 text-start font-medium">{t('catalog.code')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('serviceOrders.quantity')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('serviceOrders.ustUnit')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('serviceOrders.ustTotal')}</th>
                {canManage ? <th className="px-3 py-2" aria-hidden="true" /> : null}
              </tr>
            </thead>
            <tbody>
              {order.items.map((line) => (
                <tr key={line.id} className="border-b border-border-subtle last:border-0 align-top">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{line.catalogItemCode}</span>
                    <p className="text-xs text-fg-muted">{line.catalogItemName}</p>
                    {line.ustOverrideReason !== null ? (
                      <p className="text-xs italic text-fg-subtle">{line.ustOverrideReason}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{Number(line.quantity).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 tabular-nums">{Number(line.ustUnit).toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2 tabular-nums font-medium">
                    {Number(line.ustTotal).toLocaleString('pt-BR')}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      <IconButton
                        label={t('serviceOrders.removeLine')}
                        icon={<Trash2 className="size-4" aria-hidden="true" />}
                        size="sm"
                        variant="ghost"
                        onClick={() => void doRemoveLine(line.id)}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        adding ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
            <Field label={t('serviceOrders.catalogItem')} required requiredLabel={tc('required')}>
              <Select
                value={catalogItemId}
                onValueChange={(value) => {
                  setCatalogItemId(value);
                  setManualAdjust(false);
                  setUstUnit('');
                  setOverrideReason('');
                }}
                placeholder={t('serviceOrders.catalogItemPlaceholder')}
                options={activeCatalog.map((item) => ({ value: item.id, label: `${item.code} — ${item.name}` }))}
              />
            </Field>
            <Field label={t('serviceOrders.quantity')} required requiredLabel={tc('required')}>
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                }}
              />
            </Field>

            {selectedCatalogItem !== undefined ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-fg-muted">
                  {t('serviceOrders.ustUnit')}:{' '}
                  {effectiveUstUnit.trim() === '' ? '—' : Number(effectiveUstUnit).toLocaleString('pt-BR')}
                  {previewTotal !== null
                    ? ` · ${t('serviceOrders.ustTotal')}: ${previewTotal.toLocaleString('pt-BR')}`
                    : ''}
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={manualAdjust}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      setManualAdjust(next);
                      setUstUnit(next ? selectedCatalogItem.defaultUst : '');
                      setOverrideReason('');
                    }}
                  />
                  {t('serviceOrders.adjustManually')}
                </label>
                {manualAdjust ? (
                  <>
                    <Field label={t('serviceOrders.ustUnit')} required requiredLabel={tc('required')}>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={ustUnit}
                        onChange={(event) => {
                          setUstUnit(event.target.value);
                        }}
                      />
                    </Field>
                    {needsReason ? (
                      <Field label={t('serviceOrders.overrideReason')} required requiredLabel={tc('required')}>
                        <Textarea
                          value={overrideReason}
                          rows={2}
                          onChange={(event) => {
                            setOverrideReason(event.target.value);
                          }}
                        />
                      </Field>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={resetForm}>
                {tc('cancel')}
              </Button>
              <Button size="sm" onClick={() => void submitLine()} loading={addItem.isPending} disabled={!canSubmitLine}>
                {t('serviceOrders.confirmAddLine')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('serviceOrders.addLine')}
          </Button>
        )
      ) : null}
    </div>
  );
}
