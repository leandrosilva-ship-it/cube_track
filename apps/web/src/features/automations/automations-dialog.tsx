'use client';

import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_TYPES,
  type AutomationActionSpec,
  type AutomationActionType,
  type AutomationTriggerType,
} from '@cube-track/shared';
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@cube-track/ui';
import { Copy, Pencil, Plus, Trash2, X, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Automation, BoardDetail } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useDuplicateAutomation,
  useUpdateAutomation,
} from './hooks';
import {
  actionSummary,
  buildConditions,
  buttonColumns,
  CONDITION_OPERATORS,
  conditionsToRows,
  dateColumns,
  NATIVE_DATE_FIELDS,
  peopleColumns,
  statusColumns,
  triggerSummary,
  writableColumns,
  type AutomationInputBody,
  type ConditionOperator,
  type ConditionRow,
} from './model';

type View = { mode: 'list' } | { mode: 'form'; automation?: Automation };

export function AutomationsDialog({ board }: { board: BoardDetail }) {
  const [view, setView] = useState<View>({ mode: 'list' });

  if (view.mode === 'form') {
    return (
      <AutomationForm
        board={board}
        automation={view.automation}
        onClose={() => {
          setView({ mode: 'list' });
        }}
        onCancel={() => {
          setView({ mode: 'list' });
        }}
      />
    );
  }

  return (
    <AutomationsList
      board={board}
      onCreate={() => {
        setView({ mode: 'form' });
      }}
      onEdit={(automation) => {
        setView({ mode: 'form', automation });
      }}
    />
  );
}

function AutomationsList({
  board,
  onCreate,
  onEdit,
}: {
  board: BoardDetail;
  onCreate: () => void;
  onEdit: (automation: Automation) => void;
}) {
  const t = useTranslations('automations');
  const tc = useTranslations('common');
  const automations = useAutomations(board.id);
  const update = useUpdateAutomation(board.id);
  const duplicate = useDuplicateAutomation(board.id);
  const del = useDeleteAutomation(board.id);
  const errorMessage = useErrorMessage();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const columns = board.columns;
  const groups = board.groups;

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <Button onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t('new')}
        </Button>
      }
    >
      {automations.data === undefined ? (
        <Skeleton className="h-32" />
      ) : automations.data.length === 0 ? (
        <EmptyState
          icon={<Zap aria-hidden="true" />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {automations.data.map((automation) => {
            const trigger = triggerSummary(automation.trigger, columns, groups);
            const actionText = automation.actions
              .map((action) => {
                const summary = actionSummary(action, columns, groups);
                return t(summary.key, summary.values);
              })
              .join(', ');
            return (
              <li key={automation.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-fg">{automation.name}</p>
                    <p className="truncate text-xs text-fg-muted">{t(trigger.key, trigger.values)}</p>
                    <p className="truncate text-xs text-fg-subtle">{actionText}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      aria-label={automation.isEnabled ? t('enabled') : t('disabled')}
                      checked={automation.isEnabled}
                      onCheckedChange={(checked) => {
                        update.mutate({ id: automation.id, input: { isEnabled: checked } });
                      }}
                    />
                    <IconButton
                      label={t('edit')}
                      icon={<Pencil aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => {
                        onEdit(automation);
                      }}
                    />
                    <IconButton
                      label={t('duplicate')}
                      icon={<Copy aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => {
                        duplicate.mutate(automation.id, {
                          onError: (error) => {
                            toast.error(errorMessage(error));
                          },
                        });
                      }}
                    />
                    {confirmDeleteId === automation.id ? null : (
                      <IconButton
                        label={t('delete')}
                        icon={<Trash2 aria-hidden="true" />}
                        size="icon-sm"
                        onClick={() => {
                          setConfirmDeleteId(automation.id);
                        }}
                      />
                    )}
                  </div>
                </div>
                {confirmDeleteId === automation.id ? (
                  <div className="flex items-center justify-end gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm">
                    <span className="me-auto text-fg">{t('confirmDelete')}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirmDeleteId(null);
                      }}
                    >
                      {tc('cancel')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={del.isPending}
                      onClick={() => {
                        del.mutate(automation.id, {
                          onSuccess: () => {
                            setConfirmDeleteId(null);
                          },
                          onError: (error) => {
                            toast.error(errorMessage(error));
                          },
                        });
                      }}
                    >
                      {t('confirmDeleteAction')}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

interface ActionRowState {
  type: AutomationActionType;
  groupId: string;
  columnKey: string;
  value: string;
  useToday: boolean;
  message: string;
  peopleColumnKey: string;
}

function defaultActionRow(type: AutomationActionType = 'notify'): ActionRowState {
  return { type, groupId: '', columnKey: '', value: '', useToday: false, message: '', peopleColumnKey: '' };
}

function toActionRow(action: AutomationActionSpec): ActionRowState {
  if (action.type === 'move_to_group') {
    return { ...defaultActionRow('move_to_group'), groupId: action.config.groupId };
  }
  if (action.type === 'set_column_value') {
    const columnKey = 'columnKey' in action.config ? action.config.columnKey : '';
    const raw = action.config.value;
    const useToday =
      typeof raw === 'object' && raw !== null && (raw as { relative?: unknown }).relative === 'today';
    const value = useToday || raw === null || typeof raw === 'object' ? '' : raw;
    return { ...defaultActionRow('set_column_value'), columnKey, value, useToday };
  }
  return {
    ...defaultActionRow('notify'),
    message: action.config.message,
    peopleColumnKey: action.config.peopleColumnKey ?? '',
  };
}

function buildActionConfig(row: ActionRowState): { type: string; config: Record<string, unknown> } | null {
  if (row.type === 'move_to_group') {
    return row.groupId === '' ? null : { type: 'move_to_group', config: { groupId: row.groupId } };
  }
  if (row.type === 'set_column_value') {
    return row.columnKey === ''
      ? null
      : {
          type: 'set_column_value',
          config: { columnKey: row.columnKey, value: row.useToday ? { relative: 'today' } : row.value },
        };
  }
  if (row.message.trim() === '') return null;
  return {
    type: 'notify',
    config: {
      message: row.message.trim(),
      ...(row.peopleColumnKey === '' ? {} : { peopleColumnKey: row.peopleColumnKey }),
    },
  };
}

function AutomationForm({
  board,
  automation,
  onClose,
  onCancel,
}: {
  board: BoardDetail;
  automation?: Automation | undefined;
  onClose: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('automations');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateAutomation(board.id);
  const update = useUpdateAutomation(board.id);
  const isEdit = automation !== undefined;

  const [name, setName] = useState(automation?.name ?? '');
  const [description, setDescription] = useState(automation?.description ?? '');
  const [isEnabled, setIsEnabled] = useState(automation?.isEnabled ?? true);

  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(automation?.trigger.type ?? 'item_created');
  const [triggerGroupId, setTriggerGroupId] = useState(
    automation?.trigger.type === 'item_created' ? (automation.trigger.config.groupId ?? '') : '',
  );
  const boardStatusColumns = statusColumns(board.columns);
  const [statusColumnKey, setStatusColumnKey] = useState(
    automation?.trigger.type === 'column_value_changed'
      ? automation.trigger.config.columnKey
      : (boardStatusColumns[0]?.key ?? ''),
  );
  const [statusLabelIds, setStatusLabelIds] = useState<string[]>(
    automation?.trigger.type === 'column_value_changed'
      ? (automation.trigger.config.to ?? []).map(String)
      : [],
  );
  const boardButtonColumns = buttonColumns(board.columns);
  const [buttonColumnKey, setButtonColumnKey] = useState(
    automation?.trigger.type === 'button_clicked'
      ? automation.trigger.config.columnKey
      : (boardButtonColumns[0]?.key ?? ''),
  );
  const dateFieldOptions = [
    ...NATIVE_DATE_FIELDS.map((field) => ({ value: field, label: t(`nativeDateField.${field}`) })),
    ...dateColumns(board.columns).map((column) => ({ value: column.key, label: column.title })),
  ];
  const [dateColumnKey, setDateColumnKey] = useState(
    automation?.trigger.type === 'date_arrives'
      ? automation.trigger.config.columnKey
      : (dateFieldOptions[0]?.value ?? ''),
  );
  const [offsetDays, setOffsetDays] = useState(
    automation?.trigger.type === 'date_arrives' ? automation.trigger.config.offsetDays : 0,
  );

  const [conditionRows, setConditionRows] = useState<ConditionRow[]>(
    conditionsToRows(automation?.conditions ?? null),
  );
  const [actionRows, setActionRows] = useState<ActionRowState[]>(
    automation !== undefined && automation.actions.length > 0
      ? automation.actions.map(toActionRow)
      : [defaultActionRow()],
  );

  const writable = writableColumns(board.columns);
  const people = peopleColumns(board.columns);

  const buildTrigger = (): { type: string; config: Record<string, unknown> } | null => {
    if (triggerType === 'item_created') {
      return { type: 'item_created', config: triggerGroupId === '' ? {} : { groupId: triggerGroupId } };
    }
    if (triggerType === 'column_value_changed') {
      if (statusColumnKey === '') return null;
      return {
        type: 'column_value_changed',
        config: { columnKey: statusColumnKey, ...(statusLabelIds.length > 0 ? { to: statusLabelIds } : {}) },
      };
    }
    if (triggerType === 'button_clicked') {
      return buttonColumnKey === '' ? null : { type: 'button_clicked', config: { columnKey: buttonColumnKey } };
    }
    return dateColumnKey === ''
      ? null
      : { type: 'date_arrives', config: { columnKey: dateColumnKey, offsetDays } };
  };

  const submit = async () => {
    if (name.trim() === '') {
      toast.error(t('incomplete'));
      return;
    }
    const trigger = buildTrigger();
    if (trigger === null) {
      toast.error(t('incomplete'));
      return;
    }
    const actionConfigs = actionRows.map(buildActionConfig);
    if (actionConfigs.length === 0 || actionConfigs.some((entry) => entry === null)) {
      toast.error(t('incomplete'));
      return;
    }
    const body: AutomationInputBody = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      trigger,
      conditions: buildConditions(conditionRows),
      actions: actionConfigs as { type: string; config: Record<string, unknown> }[],
      isEnabled,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: automation.id, input: body });
      else await create.mutateAsync(body);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('editTitle') : t('createTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {tc('cancel')}
          </Button>
          <Button
            loading={create.isPending || update.isPending}
            onClick={() => {
              void submit();
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('name')} required requiredLabel={tc('required')}>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label={t('descriptionField')}>
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </Field>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm font-semibold text-fg">{t('triggerLabel')}</p>
          <Field label={t('triggerTypeLabel')}>
            <Select
              value={triggerType}
              options={AUTOMATION_TRIGGER_TYPES.map((type) => ({
                value: type,
                label: t(`triggerType.${type}`),
              }))}
              onValueChange={(value) => {
                setTriggerType(value as AutomationTriggerType);
              }}
            />
          </Field>

          {triggerType === 'item_created' ? (
            <Field label={t('triggerGroup')}>
              <Select
                value={triggerGroupId}
                options={[
                  { value: '', label: t('anyGroup') },
                  ...board.groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                onValueChange={setTriggerGroupId}
              />
            </Field>
          ) : null}

          {triggerType === 'column_value_changed' ? (
            boardStatusColumns.length === 0 ? (
              <p className="text-sm text-danger">{t('triggerColumnEmpty')}</p>
            ) : (
              <>
                <Field label={t('triggerColumn')}>
                  <Select
                    value={statusColumnKey}
                    options={boardStatusColumns.map((column) => ({ value: column.key, label: column.title }))}
                    onValueChange={(value) => {
                      setStatusColumnKey(value);
                      setStatusLabelIds([]);
                    }}
                  />
                </Field>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="text-sm text-fg-muted">{t('triggerLabels')}</legend>
                  {(boardStatusColumns.find((column) => column.key === statusColumnKey)?.labels ?? []).map(
                    (label) => (
                      <label key={label.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={statusLabelIds.includes(label.id)}
                          onCheckedChange={(checked) => {
                            setStatusLabelIds((current) =>
                              checked === true
                                ? [...current, label.id]
                                : current.filter((id) => id !== label.id),
                            );
                          }}
                        />
                        {label.label}
                      </label>
                    ),
                  )}
                </fieldset>
              </>
            )
          ) : null}

          {triggerType === 'button_clicked' ? (
            boardButtonColumns.length === 0 ? (
              <p className="text-sm text-danger">{t('triggerButtonEmpty')}</p>
            ) : (
              <Field label={t('triggerButtonColumn')}>
                <Select
                  value={buttonColumnKey}
                  options={boardButtonColumns.map((column) => ({ value: column.key, label: column.title }))}
                  onValueChange={setButtonColumnKey}
                />
              </Field>
            )
          ) : null}

          {triggerType === 'date_arrives' ? (
            <>
              <Field label={t('triggerDateColumn')}>
                <Select value={dateColumnKey} options={dateFieldOptions} onValueChange={setDateColumnKey} />
              </Field>
              <Field label={t('offsetDays')} hint={t('offsetDaysHint')}>
                <Input
                  type="number"
                  value={offsetDays}
                  onChange={(event) => {
                    setOffsetDays(Number(event.target.value));
                  }}
                />
              </Field>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">{t('conditionsLabel')}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConditionRows((rows) => [...rows, { field: '', operator: 'is', value: '' }]);
              }}
            >
              <Plus aria-hidden="true" />
              {t('addCondition')}
            </Button>
          </div>
          {conditionRows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <Select
                className="w-40"
                value={row.field}
                placeholder={t('conditionColumn')}
                options={board.columns.map((column) => ({ value: column.key, label: column.title }))}
                onValueChange={(value) => {
                  setConditionRows((rows) =>
                    rows.map((entry, i) => (i === index ? { ...entry, field: value } : entry)),
                  );
                }}
              />
              <Select
                className="w-40"
                value={row.operator}
                options={CONDITION_OPERATORS.map((operator) => ({
                  value: operator,
                  label: t(`operator.${operator}`),
                }))}
                onValueChange={(value) => {
                  setConditionRows((rows) =>
                    rows.map((entry, i) =>
                      i === index ? { ...entry, operator: value as ConditionOperator } : entry,
                    ),
                  );
                }}
              />
              {row.operator === 'is_empty' || row.operator === 'is_not_empty' ? null : (
                <Input
                  className="w-32 flex-1"
                  value={row.value}
                  placeholder={t('conditionValue')}
                  onChange={(event) => {
                    const value = event.target.value;
                    setConditionRows((rows) =>
                      rows.map((entry, i) => (i === index ? { ...entry, value } : entry)),
                    );
                  }}
                />
              )}
              <IconButton
                label={t('removeRow')}
                icon={<X aria-hidden="true" />}
                size="icon-sm"
                onClick={() => {
                  setConditionRows((rows) => rows.filter((_, i) => i !== index));
                }}
              />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-fg">{t('actionsLabel')}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActionRows((rows) => [...rows, defaultActionRow()]);
              }}
            >
              <Plus aria-hidden="true" />
              {t('addAction')}
            </Button>
          </div>
          {actionRows.map((row, index) => {
            const selectedColumn = writable.find((column) => column.key === row.columnKey);
            return (
              <div key={index} className="flex flex-col gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2">
                  <Select
                    className="flex-1"
                    value={row.type}
                    options={AUTOMATION_ACTION_TYPES.map((type) => ({
                      value: type,
                      label: t(`actionType.${type}`),
                    }))}
                    onValueChange={(value) => {
                      setActionRows((rows) =>
                        rows.map((entry, i) =>
                          i === index ? defaultActionRow(value as AutomationActionType) : entry,
                        ),
                      );
                    }}
                  />
                  <IconButton
                    label={t('removeRow')}
                    icon={<X aria-hidden="true" />}
                    size="icon-sm"
                    onClick={() => {
                      setActionRows((rows) => rows.filter((_, i) => i !== index));
                    }}
                  />
                </div>
                {row.type === 'move_to_group' ? (
                  <Field label={t('actionGroup')}>
                    <Select
                      value={row.groupId}
                      options={board.groups.map((group) => ({ value: group.id, label: group.name }))}
                      onValueChange={(value) => {
                        setActionRows((rows) =>
                          rows.map((entry, i) => (i === index ? { ...entry, groupId: value } : entry)),
                        );
                      }}
                    />
                  </Field>
                ) : null}
                {row.type === 'set_column_value' ? (
                  <>
                    <Field label={t('actionColumn')}>
                      <Select
                        value={row.columnKey}
                        options={writable.map((column) => ({ value: column.key, label: column.title }))}
                        onValueChange={(value) => {
                          setActionRows((rows) =>
                            rows.map((entry, i) =>
                              i === index ? { ...entry, columnKey: value, useToday: false } : entry,
                            ),
                          );
                        }}
                      />
                    </Field>
                    {selectedColumn?.type === 'date' ? (
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={row.useToday}
                          onCheckedChange={(checked) => {
                            setActionRows((rows) =>
                              rows.map((entry, i) =>
                                i === index ? { ...entry, useToday: checked === true } : entry,
                              ),
                            );
                          }}
                        />
                        {t('actionUseToday')}
                      </label>
                    ) : null}
                    {row.useToday ? null : (
                      <Field label={t('actionValue')} hint={t('actionValueHint')}>
                        <Input
                          value={row.value}
                          onChange={(event) => {
                            const value = event.target.value;
                            setActionRows((rows) =>
                              rows.map((entry, i) => (i === index ? { ...entry, value } : entry)),
                            );
                          }}
                        />
                      </Field>
                    )}
                  </>
                ) : null}
                {row.type === 'notify' ? (
                  <>
                    <Field label={t('actionMessage')} hint={t('actionMessageHint')}>
                      <Textarea
                        rows={2}
                        value={row.message}
                        onChange={(event) => {
                          const value = event.target.value;
                          setActionRows((rows) =>
                            rows.map((entry, i) => (i === index ? { ...entry, message: value } : entry)),
                          );
                        }}
                      />
                    </Field>
                    <Field label={t('actionPeopleColumn')}>
                      <Select
                        value={row.peopleColumnKey}
                        options={[
                          { value: '', label: t('noPeopleColumn') },
                          ...people.map((column) => ({ value: column.key, label: column.title })),
                        ]}
                        onValueChange={(value) => {
                          setActionRows((rows) =>
                            rows.map((entry, i) =>
                              i === index ? { ...entry, peopleColumnKey: value } : entry,
                            ),
                          );
                        }}
                      />
                    </Field>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
            aria-label={t('enabledField')}
          />
          {t('enabledField')}
        </label>
      </div>
    </Modal>
  );
}
