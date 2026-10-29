'use client';

import { Badge, Button, Checkbox, EmptyState, Field, IconButton, Input, Skeleton, toast } from '@cube-track/ui';
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Trash2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { GateStatus, StageGate, StageGateCriterion } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useCreateStageGate,
  useDecideStageGate,
  useDeleteStageGate,
  useReorderStageGates,
  useStageGates,
  useUpdateStageGate,
} from './model';

const GATE_TONE: Record<GateStatus, 'neutral' | 'success' | 'danger' | 'warning'> = {
  pending: 'neutral',
  approved: 'success',
  rejected: 'danger',
  skipped: 'warning',
};

export interface StageGatesPanelProps {
  boardId: string;
  canManage: boolean;
}

export function StageGatesPanel({ boardId, canManage }: StageGatesPanelProps) {
  const t = useTranslations('governance.stageGates');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const gates = useStageGates(boardId);
  const createGate = useCreateStageGate(boardId);
  const updateGate = useUpdateStageGate(boardId);
  const decideGate = useDecideStageGate(boardId);
  const reorderGates = useReorderStageGates(boardId);
  const deleteGate = useDeleteStageGate(boardId);
  const [newName, setNewName] = useState('');

  const create = async () => {
    if (newName.trim() === '') return;
    try {
      await createGate.mutateAsync({ name: newName.trim() });
      setNewName('');
      toast.success(t('created'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (gates.data === undefined) return;
    const target = index + direction;
    if (target < 0 || target >= gates.data.length) return;
    const ids = gates.data.map((gate) => gate.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(target, 0, moved);
    try {
      await reorderGates.mutateAsync(ids);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const toggleCriterion = async (gate: StageGate, criterionIndex: number) => {
    const criteria = gate.criteria.map((criterion: StageGateCriterion, index: number) =>
      index === criterionIndex ? { ...criterion, met: !criterion.met } : criterion,
    );
    try {
      await updateGate.mutateAsync({ id: gate.id, input: { criteria } });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const decide = async (id: string, status: 'approved' | 'rejected' | 'skipped') => {
    try {
      await decideGate.mutateAsync({ id, status });
      toast.success(t('decided'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteGate.mutateAsync(id);
      toast.success(t('deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (gates.data === undefined) return <Skeleton className="h-32" />;

  return (
    <div className="flex flex-col gap-4">
      {gates.data.length === 0 ? (
        <EmptyState icon={<CheckCircle2 aria-hidden="true" />} title={t('empty')} />
      ) : (
        <ol className="flex flex-col gap-3">
          {gates.data.map((gate, index) => (
            <li key={gate.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {canManage ? (
                    <div className="flex flex-col">
                      <IconButton
                        label={t('moveUp')}
                        icon={<ArrowUp aria-hidden="true" />}
                        size="sm"
                        variant="ghost"
                        disabled={index === 0}
                        onClick={() => {
                          void move(index, -1);
                        }}
                      />
                      <IconButton
                        label={t('moveDown')}
                        icon={<ArrowDown aria-hidden="true" />}
                        size="sm"
                        variant="ghost"
                        disabled={index === gates.data.length - 1}
                        onClick={() => {
                          void move(index, 1);
                        }}
                      />
                    </div>
                  ) : null}
                  <div>
                    <p className="font-medium text-fg">{gate.name}</p>
                    {gate.dueDate !== null ? (
                      <p className="text-xs text-fg-muted">
                        {t('dueDate')}: {gate.dueDate}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={GATE_TONE[gate.status]}>{t(`status.${gate.status}`)}</Badge>
                  {canManage ? (
                    <IconButton
                      label={t('delete')}
                      icon={<Trash2 aria-hidden="true" />}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void remove(gate.id);
                      }}
                    />
                  ) : null}
                </div>
              </div>
              {gate.criteria.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 ps-1">
                  {gate.criteria.map((criterion, criterionIndex) => (
                    <li key={criterionIndex} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={criterion.met}
                        disabled={!canManage}
                        onCheckedChange={() => {
                          void toggleCriterion(gate, criterionIndex);
                        }}
                        id={`${gate.id}-criterion-${criterionIndex}`}
                      />
                      <label htmlFor={`${gate.id}-criterion-${criterionIndex}`} className="text-fg-muted">
                        {criterion.label}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canManage && gate.status === 'pending' ? (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void decide(gate.id, 'approved');
                    }}
                  >
                    <CheckCircle2 aria-hidden="true" />
                    {t('approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void decide(gate.id, 'rejected');
                    }}
                  >
                    <XCircle aria-hidden="true" />
                    {t('reject')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void decide(gate.id, 'skipped');
                    }}
                  >
                    {t('skip')}
                  </Button>
                </div>
              ) : null}
              {gate.notes !== null && gate.notes !== '' ? (
                <p className="mt-2 text-xs text-fg-muted">{gate.notes}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {canManage ? (
        <Field label={t('new')}>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create();
              }}
            />
            <Button
              loading={createGate.isPending}
              onClick={() => {
                void create();
              }}
            >
              <Plus aria-hidden="true" />
              {tc('create')}
            </Button>
          </div>
        </Field>
      ) : null}
    </div>
  );
}
