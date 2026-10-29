'use client';

import { PageHeader } from '@/components/common/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import { useTree } from '../workspace/hooks';

import { HierarchyPanel } from './hierarchy-panel';
import { PrioritizationPanel } from './prioritization-panel';
import { StatusReportPanel } from './status-report-panel';
import { WhatIfPanel } from './what-if-panel';

export interface PortfolioPageProps {
  workspaceId: string;
}

/**
 * Página standalone `/w/:workspaceId/portfolio` (ADR 0053): hierarquia Portfólio → Programa →
 * Projeto, priorização, what-if e status report. Criar/editar/excluir exige `portfolio.manage`
 * (resolvido em `tree.canManagePortfolio`) — o backend decide de qualquer forma, isto é só para não
 * mostrar uma ação que vai dar 403 (mesmo padrão de `capacity-page.tsx`, ADR 0052).
 */
export function PortfolioPage({ workspaceId }: PortfolioPageProps) {
  const t = useTranslations('portfolio');
  const tree = useTree(workspaceId);
  const canManage = tree.data?.canManagePortfolio ?? false;

  return (
    <div className="flex h-full flex-col pb-10">
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />
      <div className="min-h-0 flex-1 px-4 sm:px-8">
        <Tabs defaultValue="portfolios">
          <TabsList>
            <TabsTrigger value="portfolios">{t('tabs.portfolios')}</TabsTrigger>
            <TabsTrigger value="prioritization">{t('tabs.prioritization')}</TabsTrigger>
            <TabsTrigger value="whatIf">{t('tabs.whatIf')}</TabsTrigger>
            <TabsTrigger value="statusReport">{t('tabs.statusReport')}</TabsTrigger>
          </TabsList>
          <div className="py-4">
            <TabsContent value="portfolios">
              <HierarchyPanel workspaceId={workspaceId} canManage={canManage} />
            </TabsContent>
            <TabsContent value="prioritization">
              <PrioritizationPanel workspaceId={workspaceId} canManage={canManage} />
            </TabsContent>
            <TabsContent value="whatIf">
              <WhatIfPanel workspaceId={workspaceId} />
            </TabsContent>
            <TabsContent value="statusReport">
              <StatusReportPanel workspaceId={workspaceId} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
