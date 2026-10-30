'use client';

import { Badge, Button, EmptyState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@cube-track/ui';
import { AlertTriangle, FileText, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import type { Contract } from '@/lib/api/types';

import { useTree } from '../workspace/hooks';

import { AlertsBanner } from './alerts-banner';
import { CatalogPanel } from './catalog-panel';
import { ContractDialog } from './contract-dialog';
import { useContracts } from './hooks';
import { InvoicesPanel } from './invoices-panel';
import { MeasurementsPanel } from './measurements-panel';
import { contractStatusTone, hasCriticalAlert, remainingBalancePercent, totalAlertCount } from './model';

export interface ContractsPageProps {
  workspaceId: string;
}

function ContractCard({ contract, selected, onSelect }: { contract: Contract; selected: boolean; onSelect: () => void }) {
  const t = useTranslations('contracts');
  const percent = remainingBalancePercent(contract);
  const alertCount = totalAlertCount(contract);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-2 rounded-xl border p-4 text-start transition-colors ${
        selected ? 'border-primary bg-primary-soft/40' : 'border-border bg-surface hover:border-primary/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-fg">{contract.number} — {contract.title}</p>
          <p className="truncate text-sm text-fg-muted">{contract.clientName}</p>
        </div>
        <Badge tone={contractStatusTone(contract.status)}>{t(`status.${contract.status}`)}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-subtle">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <span className="shrink-0 text-xs tabular-nums text-fg-muted">
          {contract.balance.ustBalance.toLocaleString('pt-BR')} {t('list.ustBalanceUnit')}
        </span>
      </div>
      {alertCount > 0 ? (
        <span
          className={`flex items-center gap-1 text-xs font-medium ${hasCriticalAlert(contract) ? 'text-danger' : 'text-warning'}`}
        >
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          {t('list.alertCount', { count: alertCount })}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Contratos/OS/UST (ADR 0054, módulo opcional `contracts` — ADR 0017), nível workspace: lista de
 * contratos com saldo e alertas sempre ao vivo (o backend recalcula a cada leitura), catálogo de
 * serviços, medição mensal e faturamento. As Ordens de Serviço em si (cabeçalho do board e painel do
 * item) são de uma etapa seguinte — aqui só o essencial do lado do contrato.
 */
export function ContractsPage({ workspaceId }: ContractsPageProps) {
  const t = useTranslations('contracts');
  const tree = useTree(workspaceId);
  const canManage = tree.data?.canManageContracts ?? false;
  const canMeasure = tree.data?.canMeasureContracts ?? false;
  const contracts = useContracts(workspaceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogContract, setDialogContract] = useState<'new' | Contract | null>(null);

  const selected = contracts.data?.find((contract) => contract.id === selectedId) ?? null;

  return (
    <div className="flex h-full flex-col pb-10">
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={
          canManage ? (
            <Button
              size="sm"
              onClick={() => {
                setDialogContract('new');
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('list.new')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-6 px-4 sm:px-8">
        {contracts.data === undefined ? (
          <Skeleton className="h-32" />
        ) : contracts.data.length === 0 ? (
          <EmptyState icon={<FileText aria-hidden="true" />} title={t('list.empty')} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {contracts.data.map((contract) => (
              <li key={contract.id}>
                <ContractCard
                  contract={contract}
                  selected={contract.id === selectedId}
                  onSelect={() => { setSelectedId(contract.id === selectedId ? null : contract.id); }}
                />
              </li>
            ))}
          </ul>
        )}

        {selected !== null ? (
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">
                  {selected.number} — {selected.title}
                </h2>
                <p className="text-sm text-fg-muted">{selected.clientName}</p>
              </div>
              {canManage ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDialogContract(selected);
                  }}
                >
                  {t('list.edit')}
                </Button>
              ) : null}
            </div>
            <AlertsBanner contract={selected} />
            <Tabs defaultValue="catalog">
              <TabsList>
                <TabsTrigger value="catalog">{t('tabs.catalog')}</TabsTrigger>
                <TabsTrigger value="measurements">{t('tabs.measurements')}</TabsTrigger>
                <TabsTrigger value="invoices">{t('tabs.invoices')}</TabsTrigger>
              </TabsList>
              <div className="py-4">
                <TabsContent value="catalog">
                  <CatalogPanel contractId={selected.id} canManage={canManage} />
                </TabsContent>
                <TabsContent value="measurements">
                  <MeasurementsPanel contract={selected} canMeasure={canMeasure} canInvoice={canManage} />
                </TabsContent>
                <TabsContent value="invoices">
                  <InvoicesPanel contractId={selected.id} canManage={canManage} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        ) : null}
      </div>

      {dialogContract !== null ? (
        <ContractDialog
          workspaceId={workspaceId}
          {...(dialogContract !== 'new' ? { contract: dialogContract } : {})}
          onClose={() => {
            setDialogContract(null);
          }}
        />
      ) : null}
    </div>
  );
}
