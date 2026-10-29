'use client';

import { Button, Field, Select, Skeleton } from '@cube-track/ui';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { usePortfolioStatusReport, usePortfolios, useProgramStatusReport, usePrograms } from './model';
import { RollupCard } from './rollup-card';

export interface StatusReportPanelProps {
  workspaceId: string;
}

/** Status report sob demanda (ADR 0053): exportação em PDF no cliente, mesmo padrão de Gantt/Dashboards. */
export function StatusReportPanel({ workspaceId }: StatusReportPanelProps) {
  const t = useTranslations('portfolio');
  const portfolios = usePortfolios(workspaceId);
  const programs = usePrograms(workspaceId);
  const [scope, setScope] = useState<'portfolio' | 'program'>('portfolio');
  const [entityId, setEntityId] = useState('');
  const nodeRef = useRef<HTMLDivElement>(null);

  const entities = scope === 'portfolio' ? (portfolios.data ?? []) : (programs.data ?? []);
  const entity = entities.find((item) => item.id === entityId);
  const portfolioReport = usePortfolioStatusReport(scope === 'portfolio' ? entityId || undefined : undefined);
  const programReport = useProgramStatusReport(scope === 'program' ? entityId || undefined : undefined);
  const report = scope === 'portfolio' ? portfolioReport : programReport;

  const exportPdf = async () => {
    const node = nodeRef.current;
    if (node === null) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff' });
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'l' : 'p',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${entity?.name ?? 'status-report'}.pdf`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('statusReport.scope')}>
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value as 'portfolio' | 'program');
                setEntityId('');
              }}
              options={[
                { value: 'portfolio', label: t('whatIf.scopeOptions.portfolio') },
                { value: 'program', label: t('whatIf.scopeOptions.program') },
              ]}
            />
          </Field>
          <Field label={t('whatIf.selectScope')}>
            <Select
              value={entityId}
              onValueChange={setEntityId}
              options={entities.map((item) => ({ value: item.id, label: item.name }))}
              placeholder={t('whatIf.selectScope')}
            />
          </Field>
        </div>
        {entityId !== '' && report.data !== undefined ? (
          <Button size="sm" variant="secondary" onClick={() => void exportPdf()}>
            <Download className="size-4" aria-hidden="true" />
            {t('statusReport.exportPdf')}
          </Button>
        ) : null}
      </div>

      {entityId === '' ? (
        <p className="text-sm text-fg-subtle">{t('statusReport.selectToView')}</p>
      ) : report.data === undefined ? (
        <Skeleton className="h-32" />
      ) : (
        <div ref={nodeRef} className="rounded-xl border border-border bg-surface p-6">
          <h3 className="mb-4 text-lg font-semibold">{entity?.name}</h3>
          <RollupCard rollup={report.data} />
        </div>
      )}
    </div>
  );
}
