'use client';

import { formatRelativeTime } from '@cube-track/i18n';
import { Badge, Button, EmptyState, Field, Skeleton, Textarea, toast } from '@cube-track/ui';
import { Check, History, Lock, RotateCcw, Sparkles, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { AiAgent, AiAgentRun, BoardDetail } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { actionSummary } from '../automations/model';
import { useAiAgentRuns, useAiAgents, useDecideAiAgentRun, useRevertAiAgentRun } from './hooks';
import { isRunRevertible, runStatusTone } from './model';

export interface ApprovalsPanelProps {
  board: BoardDetail;
}

/**
 * Aba "Aprovações" do diálogo de IA (ADR 0055): `GET /ai-agents/:id/runs` exige `ai.agents.approve`,
 * mas listar os agentes do board (para então listar as execuções de cada um) exige
 * `ai.agents.manage` — quem só tem `ai.agents.approve` não consegue chegar aos agentes por aqui
 * (ver relatório final da entrega). Por isso a aba mostra uma explicação clara nesse caso, em vez de
 * uma lista vazia silenciosa ou um erro 403 cru.
 */
export function ApprovalsPanel({ board }: ApprovalsPanelProps) {
  const t = useTranslations('ai.approvals');
  const canListAgents = board.permissions.includes('ai.agents.manage');
  const agents = useAiAgents(board.id, canListAgents);

  if (!canListAgents) {
    return <EmptyState icon={<Lock aria-hidden="true" />} title={t('gapTitle')} description={t('gapDescription')} />;
  }

  if (agents.data === undefined) return <Skeleton className="h-32" />;

  if (agents.data.length === 0) {
    return <EmptyState icon={<Sparkles aria-hidden="true" />} title={t('emptyTitle')} description={t('emptyDescription')} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-muted">{t('description')}</p>
      {agents.data.map((agent) => (
        <AgentRunsSection key={agent.id} board={board} agent={agent} />
      ))}
    </div>
  );
}

function AgentRunsSection({ board, agent }: { board: BoardDetail; agent: AiAgent }) {
  const t = useTranslations('ai.approvals');
  const runs = useAiAgentRuns(agent.id);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <History className="size-4 text-fg-subtle" aria-hidden="true" />
        {agent.name}
      </h3>
      {runs.data === undefined ? (
        <Skeleton className="h-16" />
      ) : runs.data.length === 0 ? (
        <p className="text-sm text-fg-subtle">{t('emptyDescription')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {runs.data.map((run) => (
            <RunCard key={run.id} board={board} agentId={agent.id} run={run} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RunCard({ board, agentId, run }: { board: BoardDetail; agentId: string; run: AiAgentRun }) {
  const t = useTranslations('ai.approvals');
  const ta = useTranslations('automations');
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const decide = useDecideAiAgentRun(agentId);
  const revert = useRevertAiAgentRun(agentId);
  const [note, setNote] = useState('');
  const [confirmingApprove, setConfirmingApprove] = useState(false);

  const action = actionSummary(run.proposedAction, board.columns, board.groups);
  const isPending = run.status === 'pending_approval';
  const canRevert = isRunRevertible(run);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={runStatusTone(run.status)}>{t(`status.${run.status}`)}</Badge>
        <span className="text-xs text-fg-subtle">{t('requestedAt', { date: formatRelativeTime(run.requestedAt, locale) })}</span>
      </div>
      <div className="rounded-md bg-surface-sunken p-2">
        <p className="text-xs font-semibold uppercase text-fg-subtle">{t('reasoningLabel')}</p>
        <p className="whitespace-pre-wrap text-sm text-fg">{run.reasoning}</p>
      </div>
      <p className="text-sm text-fg">
        <span className="font-semibold">{t('proposedActionLabel')}:</span> {ta(action.key, action.values)}
      </p>
      {isPending ? (
        <div className="flex flex-col gap-2">
          <Field label={t('noteLabel')}>
            <Textarea
              rows={2}
              value={note}
              placeholder={t('notePlaceholder')}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {confirmingApprove ? (
              <>
                <span className="text-sm text-fg">{t('confirmApprove')}</span>
                <Button
                  size="sm"
                  loading={decide.isPending}
                  onClick={() => {
                    decide.mutate(
                      { runId: run.id, decision: 'approve', ...(note.trim() === '' ? {} : { note: note.trim() }) },
                      {
                        onSettled: () => {
                          setConfirmingApprove(false);
                        },
                        onError: (error) => {
                          toast.error(errorMessage(error));
                        },
                      },
                    );
                  }}
                >
                  <Check aria-hidden="true" />
                  {t('confirmApproveAction')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setConfirmingApprove(true);
                }}
              >
                <Check aria-hidden="true" />
                {t('approve')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              loading={decide.isPending}
              onClick={() => {
                decide.mutate({ runId: run.id, decision: 'reject', ...(note.trim() === '' ? {} : { note: note.trim() }) });
              }}
            >
              <X aria-hidden="true" />
              {t('reject')}
            </Button>
          </div>
        </div>
      ) : canRevert ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          loading={revert.isPending}
          onClick={() => {
            revert.mutate(run.id);
          }}
        >
          <RotateCcw aria-hidden="true" />
          {t('revert')}
        </Button>
      ) : null}
    </li>
  );
}
