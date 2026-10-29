'use client';

import { Button, Chart, EmptyState, Select, Skeleton, StatusPill, type ChartOption } from '@cube-track/ui';
import { Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { useWorkspaceBoards } from '../table/hooks';

import { useScoringModels, useScoringRanking, useValueEffortMatrix } from './model';
import { ScoreBoardDialog } from './score-board-dialog';
import { ScoringModelDialog } from './scoring-model-dialog';

const QUADRANT_COLORS: Record<string, string> = {
  quick_win: '#00c875',
  major_project: '#4252d9',
  fill_in: '#ffcb00',
  thankless_task: '#df2f4a',
};

export interface PrioritizationPanelProps {
  workspaceId: string;
  canManage: boolean;
}

export function PrioritizationPanel({ workspaceId, canManage }: PrioritizationPanelProps) {
  const t = useTranslations('portfolio');
  const models = useScoringModels();
  const boards = useWorkspaceBoards(workspaceId, true);
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [scoring, setScoring] = useState(false);

  const modelId = selectedModelId ?? models.data?.[0]?.id;
  const model = models.data?.find((entry) => entry.id === modelId);
  const editingModelData =
    editingModel !== null && editingModel !== 'new' ? models.data?.find((entry) => entry.id === editingModel) : undefined;
  const ranking = useScoringRanking(modelId);
  const valueEffort = useValueEffortMatrix(modelId);

  const chartOption: ChartOption = useMemo(() => {
    const quadrantLabels: Record<string, string> = {
      quick_win: t('scoring.quadrant.quick_win'),
      major_project: t('scoring.quadrant.major_project'),
      fill_in: t('scoring.quadrant.fill_in'),
      thankless_task: t('scoring.quadrant.thankless_task'),
    };
    const points = valueEffort.data ?? [];
    return {
      xAxis: { type: 'value' },
      yAxis: { type: 'value' },
      tooltip: {
        trigger: 'item',
        formatter: (param: { dataIndex: number }) => {
          const point = points[param.dataIndex];
          return point === undefined ? '' : `${point.boardName}<br/>${quadrantLabels[point.quadrant] ?? ''}`;
        },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 14,
          data: points.map((point) => ({
            value: [point.effort, point.value],
            itemStyle: { color: QUADRANT_COLORS[point.quadrant] },
          })),
        },
      ],
    };
  }, [valueEffort.data, t]);

  if (models.data === undefined) return <Skeleton className="h-48" />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('scoring.title')}</h3>
        {canManage ? (
          <Button size="sm" onClick={() => { setEditingModel('new'); }}>
            {t('scoring.new')}
          </Button>
        ) : null}
      </div>

      {models.data.length === 0 ? (
        <EmptyState icon={<Target aria-hidden="true" />} title={t('scoring.empty')} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              aria-label={t('scoring.selectModel')}
              value={modelId ?? ''}
              onValueChange={setSelectedModelId}
              options={models.data.map((entry) => ({ value: entry.id, label: entry.name }))}
            />
            {model !== undefined && canManage ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => { setEditingModel(model.id); }}>
                  {t('scoring.editTitle')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { setScoring(true); }}>
                  {t('scoring.scoreBoard')}
                </Button>
              </>
            ) : null}
            {model?.isDefault === true ? <StatusPill label={t('scoring.isDefault')} color="#4252d9" /> : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium text-fg-muted">{t('scoring.ranking')}</h4>
              {ranking.data === undefined ? (
                <Skeleton className="h-32" />
              ) : ranking.data.length === 0 ? (
                <p className="text-sm text-fg-subtle">{t('scoring.rankingEmpty')}</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {ranking.data.map((entry, index) => (
                    <li
                      key={entry.boardId}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-5 text-right text-fg-subtle tabular-nums">{index + 1}.</span>
                        {entry.boardName}
                      </span>
                      <span className="font-medium tabular-nums">{entry.score.toFixed(1)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-medium text-fg-muted">{t('scoring.valueEffort')}</h4>
              {valueEffort.data === undefined ? (
                <Skeleton className="h-48" />
              ) : valueEffort.data.length < 2 ? (
                <p className="text-sm text-fg-subtle">{t('scoring.valueEffortEmpty')}</p>
              ) : (
                <>
                  <Chart ariaLabel={t('scoring.valueEffort')} height={240} option={chartOption} />
                  <p className="text-xs text-fg-subtle">{t('scoring.valueEffortHint')}</p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {editingModel !== null ? (
        <ScoringModelDialog
          {...(editingModelData === undefined ? {} : { model: editingModelData })}
          onClose={() => { setEditingModel(null); }}
        />
      ) : null}

      {scoring && model !== undefined ? (
        <ScoreBoardDialog model={model} boards={boards.data ?? []} onClose={() => { setScoring(false); }} />
      ) : null}
    </div>
  );
}
