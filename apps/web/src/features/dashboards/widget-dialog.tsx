'use client';

import { Button, Field, Input, Modal, Select, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Widget, WidgetType } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useBoard } from '../board/hooks';
import { useWorkspaceBoards } from '../table/hooks';
import { useCreateWidget, useUpdateWidget } from './hooks';
import {
  categoryColumns,
  dateColumns,
  nextWidgetLayout,
  numericColumns,
  peopleColumns,
  WIDGET_TYPE_META,
} from './model';

const AGGREGATES = ['sum', 'avg', 'min', 'max', 'count'] as const;
const COUNT_SENTINEL = '__count__';

export interface WidgetDialogProps {
  dashboardId: string;
  workspaceId: string;
  boardIds: string[];
  existingWidgets: readonly Widget[];
  widget?: Widget;
  onClose: () => void;
}

/** Criar/editar um widget: seleciona o tipo e as colunas do primeiro board-fonte do dashboard. */
export function WidgetDialog({
  dashboardId,
  workspaceId,
  boardIds,
  existingWidgets,
  widget,
  onClose,
}: WidgetDialogProps) {
  const t = useTranslations('dashboards');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const boardId = boardIds[0];
  const boardQuery = useBoard(boardId ?? '');
  const workspaceBoardsQuery = useWorkspaceBoards(workspaceId, true);
  const columns = boardQuery.data?.columns ?? [];
  const create = useCreateWidget(dashboardId);
  const update = useUpdateWidget(dashboardId);
  const isEdit = widget !== undefined;

  const [type, setType] = useState<WidgetType>(widget?.type ?? 'number');
  const [title, setTitle] = useState(widget?.title ?? '');
  const config = widget?.config ?? {};

  const [numberColumnKey, setNumberColumnKey] = useState<string>(
    (config.columnKey as string | undefined) ?? COUNT_SENTINEL,
  );
  const [numberAggregate, setNumberAggregate] = useState<string>((config.aggregate as string | undefined) ?? 'sum');
  const [barXColumnKey, setBarXColumnKey] = useState((config.xColumnKey as string | undefined) ?? '');
  const [barYColumnKey, setBarYColumnKey] = useState<string>(
    (config.yColumnKey as string | undefined) ?? COUNT_SENTINEL,
  );
  const [barAggregate, setBarAggregate] = useState<string>((config.aggregate as string | undefined) ?? 'sum');
  const [pieColumnKey, setPieColumnKey] = useState((config.columnKey as string | undefined) ?? '');
  const [batteryPlanned, setBatteryPlanned] = useState((config.plannedColumnKey as string | undefined) ?? '');
  const [batteryReplanned, setBatteryReplanned] = useState((config.replannedColumnKey as string | undefined) ?? '');
  const [batteryActual, setBatteryActual] = useState((config.actualColumnKey as string | undefined) ?? '');
  const [workloadPeople, setWorkloadPeople] = useState((config.peopleColumnKey as string | undefined) ?? '');
  const [healthBoardId, setHealthBoardId] = useState((config.boardId as string | undefined) ?? boardId ?? '');

  const buildConfig = (): Record<string, unknown> | null => {
    switch (type) {
      case 'number':
        return numberColumnKey === COUNT_SENTINEL
          ? { boardIds, aggregate: 'count' }
          : { boardIds, columnKey: numberColumnKey, aggregate: numberAggregate };
      case 'chart_bar':
        if (barXColumnKey === '') return null;
        return {
          boardIds,
          xColumnKey: barXColumnKey,
          aggregate: barAggregate,
          ...(barYColumnKey === COUNT_SENTINEL ? {} : { yColumnKey: barYColumnKey }),
        };
      case 'chart_pie':
        return pieColumnKey === '' ? null : { boardIds, columnKey: pieColumnKey };
      case 'battery':
        if (batteryPlanned === '') return null;
        return {
          boardIds,
          plannedColumnKey: batteryPlanned,
          ...(batteryReplanned === '' ? {} : { replannedColumnKey: batteryReplanned }),
          ...(batteryActual === '' ? {} : { actualColumnKey: batteryActual }),
        };
      case 'workload':
        return workloadPeople === '' ? null : { boardIds, peopleColumnKey: workloadPeople };
      case 'project_health':
        return healthBoardId === '' ? null : { boardId: healthBoardId };
    }
  };

  const submit = async () => {
    const nextConfig = buildConfig();
    if (nextConfig === null || title.trim() === '') {
      toast.error(t('widgetDialog.incomplete'));
      return;
    }
    try {
      if (isEdit) {
        await update.mutateAsync({ id: widget.id, input: { title: title.trim(), config: nextConfig } });
      } else {
        await create.mutateAsync({
          type,
          title: title.trim(),
          config: nextConfig,
          layout: nextWidgetLayout(type, existingWidgets),
        });
      }
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const columnOptions = (list: { key: string; title: string }[]) =>
    list.map((column) => ({ value: column.key, label: column.title }));
  const aggregateOptions = AGGREGATES.map((value) => ({ value, label: t(`widgetDialog.aggregate.${value}`) }));

  return (
    <Modal
      title={isEdit ? t('widgetDialog.editTitle') : t('widgetDialog.createTitle')}
      closeLabel={tc('close')}
      footer={
        <Button
          loading={create.isPending || update.isPending}
          onClick={() => {
            void submit();
          }}
        >
          {t('widgetDialog.save')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {isEdit ? null : (
          <Field label={t('widgetDialog.type')}>
            <Select
              value={type}
              options={WIDGET_TYPE_META.map((entry) => ({
                value: entry.type,
                label: t(`widgetType.${entry.type}`),
              }))}
              onValueChange={(value) => {
                setType(value as WidgetType);
              }}
            />
          </Field>
        )}
        <Field label={t('widgetDialog.title')}>
          <Input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </Field>

        {type === 'number' ? (
          <>
            <Field label={t('widgetDialog.column')}>
              <Select
                value={numberColumnKey}
                options={[
                  { value: COUNT_SENTINEL, label: t('widgetDialog.countItems') },
                  ...columnOptions(numericColumns(columns)),
                ]}
                onValueChange={setNumberColumnKey}
              />
            </Field>
            {numberColumnKey === COUNT_SENTINEL ? null : (
              <Field label={t('widgetDialog.aggregate.label')}>
                <Select value={numberAggregate} options={aggregateOptions} onValueChange={setNumberAggregate} />
              </Field>
            )}
          </>
        ) : null}

        {type === 'chart_bar' ? (
          <>
            <Field label={t('widgetDialog.xColumn')}>
              <Select
                value={barXColumnKey}
                options={columnOptions([...categoryColumns(columns), ...peopleColumns(columns)])}
                onValueChange={setBarXColumnKey}
              />
            </Field>
            <Field label={t('widgetDialog.yColumn')}>
              <Select
                value={barYColumnKey}
                options={[
                  { value: COUNT_SENTINEL, label: t('widgetDialog.countItems') },
                  ...columnOptions(numericColumns(columns)),
                ]}
                onValueChange={setBarYColumnKey}
              />
            </Field>
            {barYColumnKey === COUNT_SENTINEL ? null : (
              <Field label={t('widgetDialog.aggregate.label')}>
                <Select value={barAggregate} options={aggregateOptions} onValueChange={setBarAggregate} />
              </Field>
            )}
          </>
        ) : null}

        {type === 'chart_pie' ? (
          <Field label={t('widgetDialog.column')}>
            <Select value={pieColumnKey} options={columnOptions(categoryColumns(columns))} onValueChange={setPieColumnKey} />
          </Field>
        ) : null}

        {type === 'battery' ? (
          <>
            <Field label={t('widgetDialog.plannedColumn')}>
              <Select value={batteryPlanned} options={columnOptions(dateColumns(columns))} onValueChange={setBatteryPlanned} />
            </Field>
            <Field label={t('widgetDialog.replannedColumn')}>
              <Select
                value={batteryReplanned}
                options={[{ value: '', label: t('widgetDialog.none') }, ...columnOptions(dateColumns(columns))]}
                onValueChange={setBatteryReplanned}
              />
            </Field>
            <Field label={t('widgetDialog.actualColumn')}>
              <Select
                value={batteryActual}
                options={[{ value: '', label: t('widgetDialog.none') }, ...columnOptions(dateColumns(columns))]}
                onValueChange={setBatteryActual}
              />
            </Field>
          </>
        ) : null}

        {type === 'workload' ? (
          <Field label={t('widgetDialog.peopleColumn')}>
            <Select value={workloadPeople} options={columnOptions(peopleColumns(columns))} onValueChange={setWorkloadPeople} />
          </Field>
        ) : null}

        {type === 'project_health' ? (
          <Field label={t('widgetDialog.healthBoard')}>
            <Select
              value={healthBoardId}
              options={boardIds.map((id) => ({
                value: id,
                label: workspaceBoardsQuery.data?.find((board) => board.id === id)?.name ?? id,
              }))}
              onValueChange={setHealthBoardId}
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
