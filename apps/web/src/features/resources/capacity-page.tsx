'use client';

import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import { useTree } from '../workspace/hooks';

import { AbsencesPanel } from './absences-panel';
import { ForecastPanel } from './forecast-panel';
import { ResourceProfilesPanel } from './resource-profiles-panel';
import { ResourceRequestsPanel } from './resource-requests-panel';
import { WhatIfPanel } from './what-if-panel';
import { WorkloadTab } from './workload-tab';

/**
 * Página standalone `/w/:workspaceId/capacity` (ADR 0052): Carga de trabalho, Previsão, Perfis,
 * Ausências e Solicitações do workspace inteiro. Administração (Perfis, fila de Ausências,
 * Solicitações) só aparece para quem tem `resources.manage`/`timesheet.approve` — o backend decide
 * de qualquer forma, isto é só para não mostrar uma tela que vai dar 403.
 */
export interface CapacityPageProps {
  workspaceId: string;
}

export function CapacityPage({ workspaceId }: CapacityPageProps) {
  const t = useTranslations('capacity');
  const tree = useTree(workspaceId);
  const canManage = (tree.data?.canManageResources ?? false) || (tree.data?.canApproveTimesheet ?? false);

  return (
    <div className="flex h-full flex-col pb-10">
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />
      <div className="min-h-0 flex-1 px-4 sm:px-8">
        <Tabs defaultValue="workload">
          <TabsList>
            <TabsTrigger value="workload">{t('tabs.workload')}</TabsTrigger>
            <TabsTrigger value="whatIf">{t('tabs.whatIf')}</TabsTrigger>
            <TabsTrigger value="forecast">{t('tabs.forecast')}</TabsTrigger>
            {canManage ? <TabsTrigger value="profiles">{t('tabs.profiles')}</TabsTrigger> : null}
            <TabsTrigger value="absences">{t('tabs.absences')}</TabsTrigger>
            {canManage ? <TabsTrigger value="requests">{t('tabs.requests')}</TabsTrigger> : null}
          </TabsList>
          <div className="py-4">
            <TabsContent value="workload">
              <WorkloadTab />
            </TabsContent>
            <TabsContent value="whatIf">
              <WhatIfPanel />
            </TabsContent>
            <TabsContent value="forecast">
              <ForecastPanel />
            </TabsContent>
            {canManage ? (
              <TabsContent value="profiles">
                <ResourceProfilesPanel />
              </TabsContent>
            ) : null}
            <TabsContent value="absences">
              <AbsencesPanel canApprove={canManage} />
            </TabsContent>
            {canManage ? (
              <TabsContent value="requests">
                <ResourceRequestsPanel />
              </TabsContent>
            ) : null}
          </div>
        </Tabs>
      </div>
    </div>
  );
}
