'use client';

import { Modal, Tabs, TabsContent, TabsList, TabsTrigger } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail } from '@/lib/api/types';

import { AgentsPanel } from './ai-agents-panel';
import { ApprovalsPanel } from './ai-approvals-panel';
import { AssistantPanel } from './ai-assistant-panel';
import { CreateItemPanel } from './ai-create-item-panel';
import { PredictionsPanel } from './ai-predictions-panel';

export type AiDialogTab = 'assistant' | 'createItem' | 'predictions' | 'agents' | 'approvals';

export interface AiDialogProps {
  board: BoardDetail;
}

/** Diálogo "IA" do board (ADR 0055): assistente, criação de item por texto, previsões, agentes e
 * fila de aprovação — cada aba só aparece para quem tem a permissão correspondente. */
export function AiDialog({ board }: AiDialogProps) {
  const t = useTranslations('ai');
  const tc = useTranslations('common');
  const canUse = board.permissions.includes('ai.use');
  const canManageAgents = board.permissions.includes('ai.agents.manage');
  const canApprove = board.permissions.includes('ai.agents.approve');
  const [tab, setTab] = useState<AiDialogTab>(canUse ? 'assistant' : canManageAgents ? 'agents' : 'approvals');

  return (
    <Modal title={t('dialogTitle')} closeLabel={tc('close')} className="max-w-3xl">
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as AiDialogTab);
        }}
      >
        <TabsList className="flex-wrap">
          {canUse ? <TabsTrigger value="assistant">{t('tabs.assistant')}</TabsTrigger> : null}
          {canUse ? <TabsTrigger value="createItem">{t('tabs.createItem')}</TabsTrigger> : null}
          {canUse ? <TabsTrigger value="predictions">{t('tabs.predictions')}</TabsTrigger> : null}
          {canManageAgents ? <TabsTrigger value="agents">{t('tabs.agents')}</TabsTrigger> : null}
          {canApprove ? <TabsTrigger value="approvals">{t('tabs.approvals')}</TabsTrigger> : null}
        </TabsList>
        <div className="py-4">
          {canUse ? (
            <TabsContent value="assistant">
              <AssistantPanel boardId={board.id} />
            </TabsContent>
          ) : null}
          {canUse ? (
            <TabsContent value="createItem">
              <CreateItemPanel board={board} />
            </TabsContent>
          ) : null}
          {canUse ? (
            <TabsContent value="predictions">
              <PredictionsPanel boardId={board.id} />
            </TabsContent>
          ) : null}
          {canManageAgents ? (
            <TabsContent value="agents">
              <AgentsPanel
                board={board}
                onViewRuns={() => {
                  if (canApprove) setTab('approvals');
                }}
              />
            </TabsContent>
          ) : null}
          {canApprove ? (
            <TabsContent value="approvals">
              <ApprovalsPanel board={board} />
            </TabsContent>
          ) : null}
        </div>
      </Tabs>
    </Modal>
  );
}
