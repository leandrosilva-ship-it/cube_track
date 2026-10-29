'use client';

import { Modal, Tabs, TabsContent, TabsList, TabsTrigger } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import { useProjectHealthHistory } from '../dashboards/hooks';
import type { BoardDetail } from '@/lib/api/types';

import { BudgetPanel } from './budget-panel';
import { HealthRulesPanel } from './health-rules-panel';
import { IssuesPanel } from './issues-panel';
import { useRisks } from './model';
import { RisksPanel } from './risks-panel';
import { StageGatesPanel } from './stage-gates-panel';
import { StatusReportView } from './status-report-view';

export interface GovernanceDialogProps {
  board: BoardDetail;
}

export function GovernanceDialog({ board }: GovernanceDialogProps) {
  const t = useTranslations('governance');
  const tc = useTranslations('common');
  const canManage = board.permissions.includes('board.manage');
  const risks = useRisks(board.id);
  const history = useProjectHealthHistory(board.id);

  return (
    <Modal title={t('dialogTitle')} closeLabel={tc('close')} className="max-w-3xl">
      <Tabs defaultValue="stageGates">
        <TabsList>
          <TabsTrigger value="stageGates">{t('tabs.stageGates')}</TabsTrigger>
          <TabsTrigger value="risks">{t('tabs.risks')}</TabsTrigger>
          <TabsTrigger value="issues">{t('tabs.issues')}</TabsTrigger>
          <TabsTrigger value="budget">{t('tabs.budget')}</TabsTrigger>
          <TabsTrigger value="healthRules">{t('tabs.healthRules')}</TabsTrigger>
          <TabsTrigger value="statusReport">{t('tabs.statusReport')}</TabsTrigger>
        </TabsList>
        <div className="py-4">
          <TabsContent value="stageGates">
            <StageGatesPanel boardId={board.id} canManage={canManage} />
          </TabsContent>
          <TabsContent value="risks">
            <RisksPanel boardId={board.id} canManage={canManage} />
          </TabsContent>
          <TabsContent value="issues">
            <IssuesPanel boardId={board.id} risks={risks.data ?? []} canManage={canManage} />
          </TabsContent>
          <TabsContent value="budget">
            <BudgetPanel boardId={board.id} healthLatest={history.data?.[0] ?? null} canManage={canManage} />
          </TabsContent>
          <TabsContent value="healthRules">
            <HealthRulesPanel boardId={board.id} canManage={canManage} />
          </TabsContent>
          <TabsContent value="statusReport">
            <StatusReportView boardId={board.id} />
          </TabsContent>
        </div>
      </Tabs>
    </Modal>
  );
}
