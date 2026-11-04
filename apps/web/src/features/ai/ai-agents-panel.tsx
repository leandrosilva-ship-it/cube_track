'use client';

import {
  AUTOMATION_ACTION_TYPES,
  AUTOMATION_TRIGGER_TYPES,
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
  Select,
  Skeleton,
  Switch,
  Textarea,
  toast,
} from '@cube-track/ui';
import { Bot, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { AiAgent, BoardDetail } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  buttonColumns,
  dateColumns,
  NATIVE_DATE_FIELDS,
  statusColumns,
  triggerSummary,
} from '../automations/model';
import {
  useAiAgents,
  useCreateAiAgent,
  useDeleteAiAgent,
  useUpdateAiAgent,
  type AiAgentInputBody,
} from './hooks';
import { MAX_AGENT_ALLOWED_ACTIONS, toggleAllowedAction } from './model';

type View = { mode: 'list' } | { mode: 'form'; agent?: AiAgent };

export interface AgentsPanelProps {
  board: BoardDetail;
  /** Chamado ao pedir para ver as aprovações de um agente — a aba "Aprovações" decide o que mostrar. */
  onViewRuns: (agentId: string) => void;
}

/** Aba "Agentes" do diálogo de IA (ADR 0055): CRUD de agentes, mesmo padrão lista/formulário das
 * automações (`AutomationsDialog`) — gatilho reaproveitado quase verbatim do construtor delas. */
export function AgentsPanel({ board, onViewRuns }: AgentsPanelProps) {
  const [view, setView] = useState<View>({ mode: 'list' });

  if (view.mode === 'form') {
    return (
      <AgentForm
        board={board}
        agent={view.agent}
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
    <AgentsList
      board={board}
      onCreate={() => {
        setView({ mode: 'form' });
      }}
      onEdit={(agent) => {
        setView({ mode: 'form', agent });
      }}
      onViewRuns={onViewRuns}
    />
  );
}

function AgentsList({
  board,
  onCreate,
  onEdit,
  onViewRuns,
}: {
  board: BoardDetail;
  onCreate: () => void;
  onEdit: (agent: AiAgent) => void;
  onViewRuns: (agentId: string) => void;
}) {
  const t = useTranslations('ai.agents');
  const tc = useTranslations('common');
  const ta = useTranslations('automations');
  const canApprove = board.permissions.includes('ai.agents.approve');
  const agents = useAiAgents(board.id);
  const update = useUpdateAiAgent(board.id);
  const del = useDeleteAiAgent(board.id);
  const errorMessage = useErrorMessage();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-muted">{t('description')}</p>
        <Button size="sm" onClick={onCreate}>
          <Plus aria-hidden="true" />
          {t('new')}
        </Button>
      </div>
      {agents.data === undefined ? (
        <Skeleton className="h-32" />
      ) : agents.data.length === 0 ? (
        <EmptyState icon={<Bot aria-hidden="true" />} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {agents.data.map((agent) => {
            const trigger = triggerSummary(agent.trigger, board.columns, board.groups);
            return (
              <li key={agent.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-fg">{agent.name}</p>
                    <p className="truncate text-xs text-fg-muted">{ta(trigger.key, trigger.values)}</p>
                    <p className="truncate text-xs text-fg-subtle">
                      {agent.allowedActions.map((type) => ta(`actionType.${type}`)).join(', ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      aria-label={agent.isActive ? t('active') : t('inactive')}
                      checked={agent.isActive}
                      onCheckedChange={(checked) => {
                        update.mutate({ id: agent.id, input: { isActive: checked } });
                      }}
                    />
                    <IconButton
                      label={t('edit')}
                      icon={<Pencil aria-hidden="true" />}
                      size="icon-sm"
                      onClick={() => {
                        onEdit(agent);
                      }}
                    />
                    {confirmDeleteId === agent.id ? null : (
                      <IconButton
                        label={t('delete')}
                        icon={<Trash2 aria-hidden="true" />}
                        size="icon-sm"
                        onClick={() => {
                          setConfirmDeleteId(agent.id);
                        }}
                      />
                    )}
                  </div>
                </div>
                {canApprove ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      onViewRuns(agent.id);
                    }}
                  >
                    {t('viewRuns')}
                  </Button>
                ) : null}
                {confirmDeleteId === agent.id ? (
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
                        del.mutate(agent.id, {
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
    </div>
  );
}

function AgentForm({
  board,
  agent,
  onClose,
  onCancel,
}: {
  board: BoardDetail;
  agent?: AiAgent | undefined;
  onClose: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('ai.agents');
  const tc = useTranslations('common');
  const ta = useTranslations('automations');
  const errorMessage = useErrorMessage();
  const create = useCreateAiAgent(board.id);
  const update = useUpdateAiAgent(board.id);
  const isEdit = agent !== undefined;

  const [name, setName] = useState(agent?.name ?? '');
  const [instructions, setInstructions] = useState(agent?.instructions ?? '');
  const [isActive, setIsActive] = useState(agent?.isActive ?? true);
  const [allowedActions, setAllowedActions] = useState<AutomationActionType[]>(agent?.allowedActions ?? []);

  // --------------------------------------------------- gatilho (reaproveitado das automações) ---
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(agent?.trigger.type ?? 'item_created');
  const [triggerGroupId, setTriggerGroupId] = useState(
    agent?.trigger.type === 'item_created' ? (agent.trigger.config.groupId ?? '') : '',
  );
  const boardStatusColumns = statusColumns(board.columns);
  const [statusColumnKey, setStatusColumnKey] = useState(
    agent?.trigger.type === 'column_value_changed'
      ? agent.trigger.config.columnKey
      : (boardStatusColumns[0]?.key ?? ''),
  );
  const [statusLabelIds, setStatusLabelIds] = useState<string[]>(
    agent?.trigger.type === 'column_value_changed' ? (agent.trigger.config.to ?? []).map(String) : [],
  );
  const boardButtonColumns = buttonColumns(board.columns);
  const [buttonColumnKey, setButtonColumnKey] = useState(
    agent?.trigger.type === 'button_clicked' ? agent.trigger.config.columnKey : (boardButtonColumns[0]?.key ?? ''),
  );
  const dateFieldOptions = [
    ...NATIVE_DATE_FIELDS.map((field) => ({ value: field, label: ta(`nativeDateField.${field}`) })),
    ...dateColumns(board.columns).map((column) => ({ value: column.key, label: column.title })),
  ];
  const [dateColumnKey, setDateColumnKey] = useState(
    agent?.trigger.type === 'date_arrives' ? agent.trigger.config.columnKey : (dateFieldOptions[0]?.value ?? ''),
  );
  const [offsetDays, setOffsetDays] = useState(
    agent?.trigger.type === 'date_arrives' ? agent.trigger.config.offsetDays : 0,
  );

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
    return dateColumnKey === '' ? null : { type: 'date_arrives', config: { columnKey: dateColumnKey, offsetDays } };
  };

  const submit = async () => {
    if (name.trim() === '' || instructions.trim() === '' || allowedActions.length === 0) {
      toast.error(t('incomplete'));
      return;
    }
    const trigger = buildTrigger();
    if (trigger === null) {
      toast.error(t('incomplete'));
      return;
    }
    const body: AiAgentInputBody = {
      name: name.trim(),
      instructions: instructions.trim(),
      trigger,
      allowedActions,
      isActive,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: agent.id, input: body });
      else await create.mutateAsync(body);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <Field label={t('name')} required requiredLabel={tc('required')}>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field label={t('instructions')} hint={t('instructionsHint')} required requiredLabel={tc('required')}>
          <Textarea
            rows={4}
            maxLength={4_000}
            value={instructions}
            onChange={(event) => {
              setInstructions(event.target.value);
            }}
          />
        </Field>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm font-semibold text-fg">{ta('triggerLabel')}</p>
          <Field label={ta('triggerTypeLabel')}>
            <Select
              value={triggerType}
              options={AUTOMATION_TRIGGER_TYPES.map((type) => ({ value: type, label: ta(`triggerType.${type}`) }))}
              onValueChange={(value) => {
                setTriggerType(value as AutomationTriggerType);
              }}
            />
          </Field>

          {triggerType === 'item_created' ? (
            <Field label={ta('triggerGroup')}>
              <Select
                value={triggerGroupId}
                options={[
                  { value: '', label: ta('anyGroup') },
                  ...board.groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                onValueChange={setTriggerGroupId}
              />
            </Field>
          ) : null}

          {triggerType === 'column_value_changed' ? (
            boardStatusColumns.length === 0 ? (
              <p className="text-sm text-danger">{ta('triggerColumnEmpty')}</p>
            ) : (
              <>
                <Field label={ta('triggerColumn')}>
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
                  <legend className="text-sm text-fg-muted">{ta('triggerLabels')}</legend>
                  {(boardStatusColumns.find((column) => column.key === statusColumnKey)?.labels ?? []).map(
                    (label) => (
                      <label key={label.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={statusLabelIds.includes(label.id)}
                          onCheckedChange={(checked) => {
                            setStatusLabelIds((current) =>
                              checked === true ? [...current, label.id] : current.filter((id) => id !== label.id),
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
              <p className="text-sm text-danger">{ta('triggerButtonEmpty')}</p>
            ) : (
              <Field label={ta('triggerButtonColumn')}>
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
              <Field label={ta('triggerDateColumn')}>
                <Select value={dateColumnKey} options={dateFieldOptions} onValueChange={setDateColumnKey} />
              </Field>
              <Field label={ta('offsetDays')} hint={ta('offsetDaysHint')}>
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

        <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold text-fg">{t('allowedActionsLabel')}</legend>
          <p className="text-xs text-fg-muted">{t('allowedActionsHint')}</p>
          {AUTOMATION_ACTION_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allowedActions.includes(type)}
                disabled={
                  !allowedActions.includes(type) && allowedActions.length >= MAX_AGENT_ALLOWED_ACTIONS
                }
                onCheckedChange={() => {
                  setAllowedActions((current) => toggleAllowedAction(current, type));
                }}
              />
              {ta(`actionType.${type}`)}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} aria-label={t('enabledField')} />
          {t('enabledField')}
        </label>
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-3">
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
      </div>
    </div>
  );
}
