'use client';

import { shiftDays } from '@cube-track/shared';
import { Button, IconButton, Select, toast } from '@cube-track/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useMembers } from '../shell/hooks';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { CapacityHeatmap } from './capacity-heatmap';
import {
  useAllocationsOfUser,
  useCapacityHeatmap,
  useCapacityLeveling,
  useCreateAllocation,
  useDeleteAllocation,
  useTeams,
  useUpdateAllocation,
} from './hooks';
import { planAllocationMove } from './model';

/** Aplica uma sugestão de nivelamento buscando as alocações daquela pessoa só quando clicado. */
function LevelingSuggestionRow({
  suggestion,
  from,
  to,
  memberName,
}: {
  suggestion: { userId: string; allocationId: string; fromDate: string; toDate: string; hours: number };
  from: string;
  to: string;
  memberName: string;
}) {
  const t = useTranslations('capacity');
  const errorMessage = useErrorMessage();
  const allocations = useAllocationsOfUser(suggestion.userId, from, to);
  const createAllocation = useCreateAllocation();
  const updateAllocation = useUpdateAllocation();
  const deleteAllocation = useDeleteAllocation();

  const apply = async () => {
    const allocation = allocations.data?.find((entry) => entry.id === suggestion.allocationId);
    if (allocation === undefined) return;
    const plan = planAllocationMove(allocation, suggestion.fromDate, suggestion.toDate);
    try {
      if (plan.removeOriginalId !== undefined)
        await deleteAllocation.mutateAsync({ id: plan.removeOriginalId, boardId: allocation.boardId });
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
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span>
        {t('leveling.suggestion', {
          name: memberName,
          from: suggestion.fromDate,
          to: suggestion.toDate,
          hours: suggestion.hours,
        })}
      </span>
      <Button size="sm" variant="secondary" disabled={allocations.data === undefined} onClick={() => void apply()}>
        {t('leveling.apply')}
      </Button>
    </li>
  );
}

function rangeOf(cursor: string, granularity: 'day' | 'week' | 'month'): { from: string; to: string } {
  if (granularity === 'month') return { from: `${cursor.slice(0, 7)}-01`, to: shiftDays(`${cursor.slice(0, 7)}-01`, 89) };
  if (granularity === 'week') return { from: cursor, to: shiftDays(cursor, 27) };
  return { from: cursor, to: shiftDays(cursor, 13) };
}

/**
 * Carga de trabalho do workspace inteiro (ADR 0052): como não há um endpoint que traga as alocações
 * de todas as pessoas de uma vez fora do escopo de um board, esta aba é só leitura (sem
 * drag-and-drop) — cada sugestão de nivelamento busca as alocações da sua própria pessoa sob
 * demanda, ao ser aplicada.
 */
export function WorkloadTab() {
  const t = useTranslations('capacity');
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cursor, setCursor] = useState(today);
  const [groupBy, setGroupBy] = useState<'person' | 'team' | 'skill'>('person');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week');
  const { from, to } = rangeOf(cursor, granularity);

  const members = useMembers();
  const teams = useTeams();
  const heatmap = useCapacityHeatmap({ from, to, granularity });
  const leveling = useCapacityLeveling({ from, to });

  const teamNames = useMemo(() => new Map((teams.data ?? []).map((team) => [team.id, team.name])), [teams.data]);
  const skillNames = useMemo(() => new Map<string, string>(), []);

  const goTo = (direction: -1 | 1) => {
    const step = granularity === 'month' ? 90 : granularity === 'week' ? 28 : 14;
    setCursor(shiftDays(cursor, direction * step));
  };

  return (
    <div className="flex flex-col gap-4">
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
        <div className="ms-auto flex gap-2">
          <Select
            aria-label={t('groupByLabel')}
            value={groupBy}
            onValueChange={(value) => {
              setGroupBy(value as typeof groupBy);
            }}
            options={[
              { value: 'person', label: t('groupBy.person') },
              { value: 'team', label: t('groupBy.team') },
              { value: 'skill', label: t('groupBy.skill') },
            ]}
          />
          <Select
            aria-label={t('granularityLabel')}
            value={granularity}
            onValueChange={(value) => {
              setGranularity(value as typeof granularity);
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
        groupBy={groupBy}
        teamNames={teamNames}
        skillNames={skillNames}
      />
      {leveling.data !== undefined && leveling.data.length > 0 ? (
        <section aria-labelledby="leveling-title-ws" className="rounded-xl border border-border bg-surface p-4">
          <h3 id="leveling-title-ws" className="mb-2 text-sm font-semibold">
            {t('leveling.title')}
          </h3>
          <ul className="flex flex-col gap-2">
            {leveling.data.map((suggestion) => (
              <LevelingSuggestionRow
                key={`${suggestion.allocationId}-${suggestion.fromDate}-${suggestion.toDate}`}
                suggestion={suggestion}
                from={from}
                to={to}
                memberName={members.data?.find((entry) => entry.userId === suggestion.userId)?.name ?? suggestion.userId}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
