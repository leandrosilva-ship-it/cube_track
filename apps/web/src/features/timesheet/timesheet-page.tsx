'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cube-track/ui';
import { ClipboardCheck, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';

import { TimesheetApprovalQueue } from './approval-queue';
import { WeeklyTimesheetGrid } from './weekly-grid';

type TimesheetTab = 'mine' | 'approvals';

/** Timesheet: apontamento semanal (minha semana) e fila de aprovação (gestores) — ADR 0052. */
export function TimesheetPage() {
  const t = useTranslations('timesheet');
  const [tab, setTab] = useState<TimesheetTab>('mine');

  return (
    <div className="pb-10">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="px-4 sm:px-8">
        <Tabs value={tab} onValueChange={(value) => { setTab(value as TimesheetTab); }}>
          <TabsList>
            <TabsTrigger value="mine">
              <Clock aria-hidden="true" />
              {t('tabs.mine')}
            </TabsTrigger>
            <TabsTrigger value="approvals">
              <ClipboardCheck aria-hidden="true" />
              {t('tabs.approvals')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="mine">
            <div className="pt-4">
              <WeeklyTimesheetGrid />
            </div>
          </TabsContent>
          <TabsContent value="approvals">
            <div className="pt-4">
              <TimesheetApprovalQueue />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
