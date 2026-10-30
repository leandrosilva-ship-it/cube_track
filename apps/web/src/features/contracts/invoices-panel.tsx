'use client';

import { Badge, Button, EmptyState, Field, Input, Modal, Skeleton, toast } from '@cube-track/ui';
import { Receipt } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Invoice, InvoiceStatus } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useInvoices, useTransitionInvoice, useUpdateInvoice } from './hooks';
import { allowedInvoiceTransitions, invoiceStatusTone } from './model';

export interface InvoicesPanelProps {
  contractId: string;
  canManage: boolean;
}

/** Faturas do contrato — nascem de uma medição aprovada e seguem emitida → paga/cancelada. */
export function InvoicesPanel({ contractId, canManage }: InvoicesPanelProps) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const invoices = useInvoices(contractId);
  const transition = useTransitionInvoice(contractId);
  const update = useUpdateInvoice(contractId);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [nfeKey, setNfeKey] = useState('');

  const transitionInvoice = async (id: string, to: InvoiceStatus) => {
    try {
      await transition.mutateAsync({ id, to });
      toast.success(t('invoices.transitioned'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const startEdit = (invoice: Invoice) => {
    setEditing(invoice);
    setDueDate(invoice.dueDate ?? '');
    setNfeKey(invoice.nfeKey ?? '');
  };

  const saveEdit = async () => {
    if (editing === null) return;
    try {
      await update.mutateAsync({
        id: editing.id,
        input: { dueDate: dueDate === '' ? null : dueDate, nfeKey: nfeKey.trim() === '' ? null : nfeKey.trim() },
      });
      toast.success(t('invoices.updated'));
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (invoices.data === undefined) return <Skeleton className="h-32" />;

  return (
    <div className="flex flex-col gap-3">
      {invoices.data.length === 0 ? (
        <EmptyState icon={<Receipt aria-hidden="true" />} title={t('invoices.empty')} description={t('invoices.emptyDescription')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {invoices.data.map((invoice) => (
            <li key={invoice.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{invoice.number}</p>
                  <p className="text-xs text-fg-muted">
                    {t('invoices.issueDate')}: {invoice.issueDate}
                    {invoice.dueDate !== null ? ` · ${t('invoices.dueDate')}: ${invoice.dueDate}` : ''}
                    {' · '}
                    {Number(invoice.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </p>
                </div>
                <Badge tone={invoiceStatusTone(invoice.status)}>{t(`invoices.status.${invoice.status}`)}</Badge>
              </div>
              {canManage ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { startEdit(invoice); }}>
                    {t('invoices.edit')}
                  </Button>
                  {allowedInvoiceTransitions(invoice.status).map((next) => (
                    <Button
                      key={next}
                      size="sm"
                      variant={next === 'cancelled' ? 'ghost' : 'primary'}
                      onClick={() => void transitionInvoice(invoice.id, next)}
                    >
                      {t(`invoices.transitionTo.${next}`)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing !== null ? (
        <Modal
          title={t('invoices.editTitle')}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="ghost" onClick={() => { setEditing(null); }}>
                {tc('cancel')}
              </Button>
              <Button onClick={() => void saveEdit()} loading={update.isPending}>
                {tc('save')}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label={t('invoices.dueDate')}>
              <Input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); }} />
            </Field>
            <Field label={t('invoices.nfeKey')}>
              <Input
                value={nfeKey}
                maxLength={44}
                placeholder={t('invoices.nfeKeyPlaceholder')}
                onChange={(event) => { setNfeKey(event.target.value); }}
              />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
