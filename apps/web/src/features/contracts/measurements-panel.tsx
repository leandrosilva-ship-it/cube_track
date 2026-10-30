'use client';

import { Badge, Button, EmptyState, Field, Input, Modal, Skeleton, Textarea, toast } from '@cube-track/ui';
import { FileBarChart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Contract, Measurement } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateInvoice, useDecideMeasurement, useGenerateMeasurement, useMeasurements, useUpdateMeasurement } from './hooks';
import { canInvoiceMeasurement, isMeasurementEditable, measurementStatusTone } from './model';

export interface MeasurementsPanelProps {
  contract: Contract;
  canMeasure: boolean;
  canInvoice: boolean;
}

/**
 * Medição mensal (ADR 0054): `measuredUst` sempre vem do backend como a soma das OS aceitas do
 * período — esta tela só exibe o resultado e conduz o fluxo gerar → ajustar glosa → decidir → faturar.
 */
export function MeasurementsPanel({ contract, canMeasure, canInvoice }: MeasurementsPanelProps) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const measurements = useMeasurements(contract.id);
  const generate = useGenerateMeasurement(contract.id);
  const update = useUpdateMeasurement(contract.id);
  const decide = useDecideMeasurement(contract.id);
  const createInvoice = useCreateInvoice(contract.id);

  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [editing, setEditing] = useState<Measurement | null>(null);
  const [glosaUst, setGlosaUst] = useState('0');
  const [notes, setNotes] = useState('');
  const [invoicing, setInvoicing] = useState<Measurement | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDueDate, setInvoiceDueDate] = useState('');

  const generateMeasurement = async () => {
    if (periodStart === '' || periodEnd === '') return;
    try {
      await generate.mutateAsync({ periodStart, periodEnd });
      toast.success(t('measurements.generated'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const startEdit = (measurement: Measurement) => {
    setEditing(measurement);
    setGlosaUst(measurement.glosaUst);
    setNotes(measurement.notes ?? '');
  };

  const saveEdit = async () => {
    if (editing === null) return;
    try {
      await update.mutateAsync({
        id: editing.id,
        input: { glosaUst, notes: notes.trim() === '' ? null : notes.trim() },
      });
      toast.success(t('measurements.updated'));
      setEditing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const decideMeasurement = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await decide.mutateAsync({ id, status });
      toast.success(status === 'approved' ? t('measurements.approved') : t('measurements.rejected'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const startInvoice = (measurement: Measurement) => {
    setInvoicing(measurement);
    setInvoiceNumber('');
    setInvoiceDueDate('');
  };

  const submitInvoice = async () => {
    if (invoicing === null || invoiceNumber.trim() === '') return;
    try {
      await createInvoice.mutateAsync({
        measurementId: invoicing.id,
        input: { number: invoiceNumber.trim(), dueDate: invoiceDueDate === '' ? null : invoiceDueDate },
      });
      toast.success(t('measurements.invoiced'));
      setInvoicing(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (measurements.data === undefined) return <Skeleton className="h-32" />;

  return (
    <div className="flex flex-col gap-4">
      {canMeasure ? (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border-subtle p-3">
          <Field label={t('measurements.periodStart')}>
            <Input type="date" value={periodStart} onChange={(event) => { setPeriodStart(event.target.value); }} />
          </Field>
          <Field label={t('measurements.periodEnd')}>
            <Input type="date" value={periodEnd} onChange={(event) => { setPeriodEnd(event.target.value); }} />
          </Field>
          <Button
            onClick={() => void generateMeasurement()}
            loading={generate.isPending}
            disabled={periodStart === '' || periodEnd === ''}
          >
            {t('measurements.generate')}
          </Button>
        </div>
      ) : null}

      {measurements.data.length === 0 ? (
        <EmptyState icon={<FileBarChart aria-hidden="true" />} title={t('measurements.empty')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {measurements.data.map((measurement) => (
            <li key={measurement.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {measurement.periodStart} — {measurement.periodEnd}
                  </p>
                  <p className="text-xs text-fg-muted">
                    {t('measurements.measuredUst')}: {Number(measurement.measuredUst).toLocaleString('pt-BR')}
                    {' · '}
                    {t('measurements.glosaUst')}: {Number(measurement.glosaUst).toLocaleString('pt-BR')}
                    {measurement.approvedUst !== null
                      ? ` · ${t('measurements.approvedUst')}: ${Number(measurement.approvedUst).toLocaleString('pt-BR')}`
                      : ''}
                  </p>
                </div>
                <Badge tone={measurementStatusTone(measurement.status)}>
                  {t(`measurements.status.${measurement.status}`)}
                </Badge>
              </div>
              {canMeasure && isMeasurementEditable(measurement.status) ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { startEdit(measurement); }}>
                    {t('measurements.edit')}
                  </Button>
                  <Button size="sm" onClick={() => void decideMeasurement(measurement.id, 'approved')}>
                    {t('measurements.approve')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void decideMeasurement(measurement.id, 'rejected')}>
                    {t('measurements.reject')}
                  </Button>
                </div>
              ) : null}
              {canInvoice && canInvoiceMeasurement(measurement) ? (
                <div className="mt-3">
                  <Button size="sm" variant="secondary" onClick={() => { startInvoice(measurement); }}>
                    {t('measurements.invoice')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing !== null ? (
        <Modal
          title={t('measurements.editTitle')}
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
            <Field label={t('measurements.glosaUst')}>
              <Input
                type="number"
                min="0"
                step="0.0001"
                max={editing.measuredUst}
                value={glosaUst}
                onChange={(event) => { setGlosaUst(event.target.value); }}
              />
            </Field>
            <Field label={t('measurements.notes')}>
              <Textarea value={notes} onChange={(event) => { setNotes(event.target.value); }} rows={3} />
            </Field>
          </div>
        </Modal>
      ) : null}

      {invoicing !== null ? (
        <Modal
          title={t('measurements.invoiceTitle')}
          closeLabel={tc('close')}
          footer={
            <>
              <Button variant="ghost" onClick={() => { setInvoicing(null); }}>
                {tc('cancel')}
              </Button>
              <Button
                onClick={() => void submitInvoice()}
                loading={createInvoice.isPending}
                disabled={invoiceNumber.trim() === ''}
              >
                {tc('save')}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label={t('invoices.number')}>
              <Input value={invoiceNumber} onChange={(event) => { setInvoiceNumber(event.target.value); }} />
            </Field>
            <Field label={t('invoices.dueDate')}>
              <Input type="date" value={invoiceDueDate} onChange={(event) => { setInvoiceDueDate(event.target.value); }} />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
