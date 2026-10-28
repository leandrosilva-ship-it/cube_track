'use client';

import { shiftDays } from '@cube-track/shared';
import { Button, Dialog, IconButton, Select, toast } from '@cube-track/ui';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useMe, useMembers } from '../shell/hooks';
import type { Allocation, BoardDetail, BoardView } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { CapacityHeatmap } from './capacity-heatmap';
import {
  useAllocationsOfBoard,
  useCapacityHeatmap,
  useCapacityLeveling,
  useCreateAllocation,
  useDeleteAllocation,
  useTeams,
  useUpdateAllocation,
} from './hooks';
import { planAllocationMove } from './model';
import { NewAllocationDialog } from './new-allocation-dialog';
import { useWorkloadConfig } from './use-workload-config';

export interface WorkloadViewProps {
  board: BoardDetail;
  view: BoardView;
}

function rangeOf(cursor: string, granularity: 'day' | 'week' | 'month'): { from: string; to: string } {
  if (granularity === 'month') return { from: `${cursor.slice(0, 7)}-01`, to: shiftDays(`${cursor.slice(0, 7)}-01`, 89) };
  if (granularity === 'week') return { from: cursor, to: shiftDays(cursor, 27) };
  return { from: cursor, to: shiftDays(cursor, 13) };
}

/**
 * View `workload` embutida no board (ADR 0052): heatmap de capacidade escopado às alocações deste
 * board, com arrastar-e-soltar para redistribuir e sugestões de nivelamento. Só aqui (não na página
 * standalone de workspace) o drag-and-drop e "aplicar sugestão" ficam disponíveis: as alocações do
 * board inteiro vêm numa única chamada (`GET /v1/boards/:id/allocations`), o que não existe num
 * escopo de workspace sem iterar usuário a usuário.
 */
export function WorkloadView({ board, view }: WorkloadViewProps) {
  const t = useTranslations('capacity');
  const { config, setConfig } = useWorkloadConfig(board.id, view);
  const errorMessage = useErrorMessage();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cursor, setCursor] = useState(today);
  const [newAllocationOpen, setNewAllocationOpen] = useState(false);
  const { from, to } = rangeOf(cursor, config.granularity);

  const me = useMe();
  const canManage = (me.data?.tenant.permissions ?? []).includes('resources.manage');
  const members = useMembers();
  const teams = useTeams();
  const heatmap = useCapacityHeatmap({ from, to, granularity: config.granularity, boardId: board.id });
  const leveling = useCapacityLeveling({ from, to, boardId: board.id });
  const allocations = useAllocationsOfBoard(board.id, from, to);
  const createAllocation = useCreateAllocation();
  const updateAllocation = useUpdateAllocation();
  const deleteAllocation = useDeleteAllocation();

  const teamNames = useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team.name])),
    [teams.data],
  );
  const skillNames = useMemo(() => new Map<string, string>(), []);

  const applyMove = (allocation: Allocation, fromDate: string, toDate: string) => {
    if (fromDate === toDate) return;
    const plan = planAllocationMove(allocation, fromDate, toDate);
    const run = async () => {
      if (plan.removeOriginalId !== undefined)
        await deleteAllocation.mutateAsync({ id: plan.removeOriginalId, boardId: board.id });
      else if (plan.patchOriginal !== undefined)
        await updateAllocation.mutateAsync({
          id: plan.patchOriginal.id,
          input: { startDate: plan.patchOriginal.startDate, endDate: plan.patchOriginal.endDate },
        });
      for (const extra of plan.extraCreates)
        await createAllocation.mutateAsync({
          userId: allocation.userId,
          boardId: allocation.boardId,
          itemId: allocation.itemId,
          startDate: extra.startDate,
          endDate: extra.endDate,
          hoursPerDay: extra.hoursPerDay,
          status: allocation.status,
        });
      await createAllocation.mutateAsync({
        userId: allocation.userId,
        boardId: allocation.boardId,
        itemId: allocation.itemId,
        startDate: plan.targetCreate.startDate,
        endDate: plan.targetCreate.endDate,
        hoursPerDay: plan.targetCreate.hoursPerDay,
        status: allocation.status,
      });
    };
    run().catch((error: unknown) => {
      toast.error(errorMessage(error));
    });
  };

  const goTo = (direction: -1 | 1) => {
    const step = config.granularity === 'month' ? 90 : config.granularity === 'week' ? 28 : 14;
    setCursor(shiftDays(cursor, direction * step));
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          label={t('previous')}
          icon={<ChevronLeft aria-hidden="true" />}
          size="icon-sm"
          onClick={() => {
            goTo(-1);
          }}
        />
        <IconButton
          label={t('next')}
          icon={<ChevronRight aria-hidden="true" />}
          size="icon-sm"
          onClick={() => {
            goTo(1);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setCursor(today);
          }}
        >
          {t('today')}
        </Button>
        <span className="text-sm font-semibold">
          {from} – {to}
        </span>
        {canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setNewAllocationOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            {t('allocations.new')}
          </Button>
        ) : null}
        <div className="ms-auto flex gap-2">
          <Select
            aria-label={t('groupByLabel')}
            value={config.groupBy}
            onValueChange={(value) => {
              setConfig({ groupBy: value as typeof config.groupBy });
            }}
            options={[
              { value: 'person', label: t('groupBy.person') },
              { value: 'team', label: t('groupBy.team') },
              { value: 'skill', label: t('groupBy.skill') },
            ]}
          />
          <Select
            aria-label={t('granularityLabel')}
            value={config.granularity}
            onValueChange={(value) => {
              setConfig({ granularity: value as typeof config.granularity });
            }}
            options={[
              { value: 'day', label: t('granularity.day') },
              { value: 'week', label: t('granularity.week') },
              { value: 'month', label: t('granularity.month') },
            ]}
          />
        </div>
      </div>
      <CapacityHeatmap
        heatmap={heatmap.data}
        loading={heatmap.isLoading}
        groupBy={config.groupBy}
        teamNames={teamNames}
        skillNames={skillNames}
        {...(config.groupBy === 'person' && config.granularity === 'day' && allocations.data !== undefined
          ? { dnd: { allocations: allocations.data, onMove: applyMove } }
          : {})}
      />
      {leveling.data !== undefined && leveling.data.length > 0 ? (
        <section aria-labelledby="leveling-title" className="rounded-xl border border-border bg-surface p-4">
          <h3 id="leveling-title" className="mb-2 text-sm font-semibold">
            {t('leveling.title')}
          </h3>
          <ul className="flex flex-col gap-2">
            {leveling.data.map((suggestion) => {
              const member = members.data?.find((entry) => entry.userId === suggestion.userId);
              const allocation = allocations.data?.find((entry) => entry.id === suggestion.allocationId);
              return (
                <li
                  key={`${suggestion.allocationId}-${suggestion.fromDate}-${suggestion.toDate}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {t('leveling.suggestion', {
                      name: member?.name ?? suggestion.userId,
                      from: suggestion.fromDate,
                      to: suggestion.toDate,
                      hours: suggestion.hours,
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={allocation === undefined}
                    onClick={() => {
                      if (allocation !== undefined) applyMove(allocation, suggestion.fromDate, suggestion.toDate);
                    }}
                  >
                    {t('leveling.apply')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <Dialog
        open={newAllocationOpen}
        onOpenChange={(open) => {
          setNewAllocationOpen(open);
        }}
      >
        {newAllocationOpen ? (
          <NewAllocationDialog
            board={board}
            onClose={() => {
              setNewAllocationOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
