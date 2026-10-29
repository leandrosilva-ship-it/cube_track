'use client';

import { Badge, Button, Skeleton } from '@cube-track/ui';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';

import type { HealthStatus } from '@/lib/api/types';

import { useBoardStatusReport } from './model';

const HEALTH_TONE: Record<HealthStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
  grey: 'neutral',
};

export interface StatusReportViewProps {
  boardId: string;
}

export function StatusReportView({ boardId }: StatusReportViewProps) {
  const t = useTranslations('governance.statusReport');
  const report = useBoardStatusReport(boardId);
  const nodeRef = useRef<HTMLDivElement>(null);

  const exportPdf = async () => {
    const node = nodeRef.current;
    if (node === null || report.data === undefined) return;
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const canvas = await html2canvas(node, { backgroundColor: '#ffffff' });
    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? 'l' : 'p',
      unit: 'px',
      format: [canvas.width, canvas.height],
    });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
    pdf.save(`${report.data.boardName}-status-report.pdf`);
  };

  if (report.data === undefined) return <Skeleton className="h-64" />;
  const data = report.data;
  const latest = data.health.latest;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void exportPdf();
          }}
        >
          <Download aria-hidden="true" />
          {t('exportPdf')}
        </Button>
      </div>
      <div ref={nodeRef} className="flex flex-col gap-4 bg-surface p-4">
        <div>
          <h3 className="text-lg font-semibold text-fg">{data.boardName}</h3>
          <p className="text-sm text-fg-muted">
            {t('percentComplete')}: {data.percentComplete.toFixed(1)}%
          </p>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('health')}</p>
          {latest === null ? (
            <p className="text-sm text-fg-muted">—</p>
          ) : (
            <Badge tone={HEALTH_TONE[latest.overall]}>{latest.overall}</Badge>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('evm')}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-fg-muted">PV</dt>
              <dd className="font-medium tabular-nums">{data.evm.pv.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">EV</dt>
              <dd className="font-medium tabular-nums">{data.evm.ev.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">AC</dt>
              <dd className="font-medium tabular-nums">{data.evm.ac.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">SPI</dt>
              <dd className="font-medium tabular-nums">{data.evm.spi?.toFixed(2) ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">CPI</dt>
              <dd className="font-medium tabular-nums">{data.evm.cpi?.toFixed(2) ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">EAC</dt>
              <dd className="font-medium tabular-nums">{data.evm.eac.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">VAC</dt>
              <dd className="font-medium tabular-nums">{data.evm.vac.toFixed(2)}</dd>
            </div>
          </dl>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('budget')}</p>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-1">
            <div>
              <dt className="text-xs text-fg-muted">{t('plannedAmount')}</dt>
              <dd className="font-medium tabular-nums">{data.budget.plannedAmount.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t('actualAmount')}</dt>
              <dd className="font-medium tabular-nums">{data.budget.actualAmount.toFixed(2)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">{t('forecastAmount')}</dt>
              <dd className="font-medium tabular-nums">{data.budget.forecastAmount.toFixed(2)}</dd>
            </div>
          </dl>
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('openRisks')}</p>
          {data.openRisks.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noRisks')}</p>
          ) : (
            <ul className="list-inside list-disc text-sm text-fg">
              {data.openRisks.map((risk) => (
                <li key={risk.id}>
                  {risk.title} ({risk.probability}×{risk.impact})
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('openIssues')}</p>
          {data.openIssues.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noIssues')}</p>
          ) : (
            <ul className="list-inside list-disc text-sm text-fg">
              {data.openIssues.map((issue) => (
                <li key={issue.id}>{issue.title}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium text-fg">{t('stageGates')}</p>
          {data.stageGates.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('noGates')}</p>
          ) : (
            <ul className="list-inside list-disc text-sm text-fg">
              {data.stageGates.map((gate) => (
                <li key={gate.id}>
                  {gate.name} — {gate.status}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
