'use client';

import { Button, Field, IconButton, Input, Select, toast } from '@cube-track/ui';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { PortfolioWhatIfAction, PortfolioWhatIfChange, PortfolioWhatIfResponse } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useWorkspaceBoards } from '../table/hooks';

import { usePortfolios, usePrograms, useWhatIfSimulation } from './model';

export interface WhatIfPanelProps {
  workspaceId: string;
}

function emptyChange(boardId: string): PortfolioWhatIfChange {
  return { boardId, action: 'exclude' };
}

/**
 * Simulação what-if (ADR 0053): incluir/excluir/adiar projetos de um portfólio/programa sem gravar
 * nada — o servidor só calcula o cenário (`WhatIfService.simulate`, motor puro `applyWhatIfChanges`).
 * O board candidato a cada mudança vem de todos os boards do workspace (não há endpoint que liste
 * só os boards de um portfólio/programa) — uma mudança para um board fora do escopo real
 * simplesmente não afeta o resultado.
 */
export function WhatIfPanel({ workspaceId }: WhatIfPanelProps) {
  const t = useTranslations('portfolio');
  const errorMessage = useErrorMessage();
  const portfolios = usePortfolios(workspaceId);
  const programs = usePrograms(workspaceId);
  const boards = useWorkspaceBoards(workspaceId, true);
  const simulate = useWhatIfSimulation();

  const [scope, setScope] = useState<'portfolio' | 'program'>('portfolio');
  const [entityId, setEntityId] = useState('');
  const [changes, setChanges] = useState<PortfolioWhatIfChange[]>([]);
  const [result, setResult] = useState<PortfolioWhatIfResponse | undefined>(undefined);

  const entities = scope === 'portfolio' ? (portfolios.data ?? []) : (programs.data ?? []);
  const boardOptions = (boards.data ?? []).map((board) => ({ value: board.id, label: board.name }));

  const run = async () => {
    if (entityId === '' || changes.length === 0) return;
    try {
      const response = await simulate.mutateAsync({ scope, id: entityId, changes });
      setResult(response);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">{t('whatIf.description')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('whatIf.scope')}>
          <Select
            value={scope}
            onValueChange={(value) => {
              setScope(value as 'portfolio' | 'program');
              setEntityId('');
              setResult(undefined);
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
            onValueChange={(value) => {
              setEntityId(value);
              setResult(undefined);
            }}
            options={entities.map((entity) => ({ value: entity.id, label: entity.name }))}
            placeholder={t('whatIf.selectScope')}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        {changes.map((change, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
            <Field label={t('whatIf.boardLabel')}>
              <Select
                value={change.boardId}
                onValueChange={(value) => { setChanges((current) => current.map((c, i) => (i === index ? { ...c, boardId: value } : c))); }
                }
                options={boardOptions}
              />
            </Field>
            <Field label={t('whatIf.action')}>
              <Select
                value={change.action}
                onValueChange={(value) => { setChanges((current) =>
                    current.map((c, i) => (i === index ? { ...c, action: value as PortfolioWhatIfAction } : c)),
                  ); }
                }
                options={(['include', 'exclude', 'delay'] as const).map((value) => ({
                  value,
                  label: t(`whatIf.actionOptions.${value}`),
                }))}
              />
            </Field>
            {change.action === 'delay' ? (
              <Field label={t('whatIf.delayDays')}>
                <Input
                  type="number"
                  value={change.delayDays ?? 0}
                  onChange={(event) => { setChanges((current) =>
                      current.map((c, i) => (i === index ? { ...c, delayDays: Number(event.target.value) } : c)),
                    ); }
                  }
                />
              </Field>
            ) : null}
            <IconButton
              size="sm"
              variant="ghost"
              label={t('whatIf.removeChange')}
              icon={<Trash2 className="size-4" aria-hidden="true" />}
              onClick={() => { setChanges((current) => current.filter((_, i) => i !== index)); }}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={boardOptions.length === 0}
            onClick={() => {
              const first = boardOptions[0];
              if (first !== undefined) setChanges((current) => [...current, emptyChange(first.value)]);
            }}
          >
            {t('whatIf.addChange')}
          </Button>
          <Button size="sm" disabled={entityId === '' || changes.length === 0} loading={simulate.isPending} onClick={() => void run()}>
            {t('whatIf.simulate')}
          </Button>
        </div>
      </div>

      {result === undefined ? (
        <p className="text-sm text-fg-subtle">{t('whatIf.noResult')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(['baseline', 'simulated'] as const).map((key) => (
            <div key={key} className="rounded-lg border border-border p-3">
              <h4 className="mb-2 text-sm font-semibold">{t(`whatIf.${key}`)}</h4>
              <dl className="flex flex-col gap-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-fg-muted">{t('whatIf.activeProjects')}</dt>
                  <dd className="font-medium tabular-nums">{result[key].activeProjects}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">{t('whatIf.totalPlannedCost')}</dt>
                  <dd className="font-medium tabular-nums">{result[key].totalPlannedCost.toLocaleString('pt-BR')}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">{t('whatIf.latestEndDate')}</dt>
                  <dd className="font-medium tabular-nums">{result[key].latestEndDate ?? t('whatIf.noEndDate')}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
