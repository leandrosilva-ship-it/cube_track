'use client';

import {
  Badge,
  Button,
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
import { Clock, GitBranch, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail, Phase, PhaseKind, Sla, TransitionRule } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useCreatePhase,
  useCreatePipe,
  useCreateSla,
  useCreateTransitionRule,
  useDeletePhase,
  useDeletePipe,
  useDeleteSla,
  useDeleteTransitionRule,
  useProcessConfig,
  useSlas,
  useUpdatePhase,
  useUpdateSla,
  useUpdateTransitionRule,
} from './hooks';
import {
  formatTargetMinutes,
  phaseName,
  slaScopeLabel,
  transitionFromSummary,
  type DurationParts,
  type PhaseInputBody,
  type SlaInputBody,
  type TransitionRuleInputBody,
} from './model';

const PHASE_KINDS: PhaseKind[] = ['start', 'intermediate', 'done', 'cancelled'];

type DeleteTarget = { kind: 'phase' | 'rule' | 'sla'; id: string } | null;

type View =
  | { mode: 'overview' }
  | { mode: 'phase-form'; phase?: Phase }
  | { mode: 'transition-form'; rule?: TransitionRule }
  | { mode: 'sla-form'; sla?: Sla };

export function ProcessSettingsDialog({ board }: { board: BoardDetail }) {
  const t = useTranslations('processes');
  const tc = useTranslations('common');
  const config = useProcessConfig(board.id);
  const [view, setView] = useState<View>({ mode: 'overview' });

  if (config.data === undefined) {
    return (
      <Modal title={t('title')} closeLabel={tc('close')}>
        <Skeleton className="h-32" />
      </Modal>
    );
  }

  if (config.data.pipe === null) {
    return <PipeSetup boardId={board.id} />;
  }

  const pipe = config.data.pipe;

  if (view.mode === 'phase-form') {
    return (
      <PhaseForm
        boardId={board.id}
        pipeId={pipe.id}
        phase={view.phase}
        onDone={() => { setView({ mode: 'overview' }); }}
      />
    );
  }

  if (view.mode === 'transition-form') {
    return (
      <TransitionForm
        boardId={board.id}
        pipeId={pipe.id}
        phases={config.data.phases}
        rule={view.rule}
        onDone={() => { setView({ mode: 'overview' }); }}
      />
    );
  }

  if (view.mode === 'sla-form') {
    return (
      <SlaForm
        boardId={board.id}
        pipe={pipe}
        phases={config.data.phases}
        sla={view.sla}
        onDone={() => { setView({ mode: 'overview' }); }}
      />
    );
  }

  return (
    <ProcessOverview
      board={board}
      pipe={pipe}
      phases={config.data.phases}
      transitionRules={config.data.transitionRules}
      onNewPhase={() => { setView({ mode: 'phase-form' }); }}
      onEditPhase={(phase) => { setView({ mode: 'phase-form', phase }); }}
      onNewRule={() => { setView({ mode: 'transition-form' }); }}
      onEditRule={(rule) => { setView({ mode: 'transition-form', rule }); }}
      onNewSla={() => { setView({ mode: 'sla-form' }); }}
      onEditSla={(sla) => { setView({ mode: 'sla-form', sla }); }}
    />
  );
}

// ------------------------------------------------------------------------------------ pipe ---

function PipeSetup({ boardId }: { boardId: string }) {
  const t = useTranslations('processes');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreatePipe(boardId);
  const [name, setName] = useState('');

  const submit = async () => {
    if (name.trim() === '') {
      toast.error(t('incomplete'));
      return;
    }
    try {
      await create.mutateAsync({ name: name.trim(), description: null });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('title')}
      description={t('setupDescription')}
      closeLabel={tc('close')}
      footer={
        <Button
          loading={create.isPending}
          onClick={() => {
            void submit();
          }}
        >
          {t('setupCreate')}
        </Button>
      }
    >
      <Field label={t('pipeName')} required requiredLabel={tc('required')}>
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </Field>
    </Modal>
  );
}

// -------------------------------------------------------------------------------- overview ---

function ProcessOverview({
  board,
  pipe,
  phases,
  transitionRules,
  onNewPhase,
  onEditPhase,
  onNewRule,
  onEditRule,
  onNewSla,
  onEditSla,
}: {
  board: BoardDetail;
  pipe: { id: string; name: string };
  phases: Phase[];
  transitionRules: TransitionRule[];
  onNewPhase: () => void;
  onEditPhase: (phase: Phase) => void;
  onNewRule: () => void;
  onEditRule: (rule: TransitionRule) => void;
  onNewSla: () => void;
  onEditSla: (sla: Sla) => void;
}) {
  const t = useTranslations('processes');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const slas = useSlas(board.id);
  const deletePhase = useDeletePhase(board.id);
  const deleteRule = useDeleteTransitionRule(board.id);
  const deleteSla = useDeleteSla(board.id);
  const deletePipe = useDeletePipe(board.id);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget>(null);
  const [confirmDeletePipe, setConfirmDeletePipe] = useState(false);

  const runDelete = (target: NonNullable<DeleteTarget>) => {
    const mutation = target.kind === 'phase' ? deletePhase : target.kind === 'rule' ? deleteRule : deleteSla;
    mutation.mutate(target.id, {
      onSuccess: () => { setConfirmDelete(null); },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <Modal
      title={t('title')}
      description={pipe.name}
      closeLabel={tc('close')}
      footer={
        confirmDeletePipe ? (
          <div className="flex w-full items-center justify-end gap-2">
            <span className="me-auto text-sm text-fg">{t('confirmDeletePipe')}</span>
            <Button variant="ghost" size="sm" onClick={() => { setConfirmDeletePipe(false); }}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={deletePipe.isPending}
              onClick={() => {
                deletePipe.mutate(pipe.id, {
                  onError: (error) => toast.error(errorMessage(error)),
                });
              }}
            >
              {t('confirmDeletePipeAction')}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => { setConfirmDeletePipe(true); }}>
            <Trash2 aria-hidden="true" />
            {t('deletePipe')}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Layers aria-hidden="true" className="size-4" />
              {t('phasesLabel')}
            </p>
            <Button variant="ghost" size="sm" onClick={onNewPhase}>
              <Plus aria-hidden="true" />
              {t('addPhase')}
            </Button>
          </div>
          {phases.length === 0 ? (
            <EmptyState title={t('phasesEmpty')} />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {phases.map((phase) => (
                <li key={phase.id} className="flex flex-col gap-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm text-fg">{phase.name}</span>
                      <Badge tone={phaseKindTone(phase.kind)}>{t(`kind.${phase.kind}`)}</Badge>
                      {phase.wipLimit !== null ? (
                        <span className="shrink-0 text-xs text-fg-muted">
                          {t('wipLimitShort', { limit: phase.wipLimit })}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <IconButton
                        label={t('edit')}
                        icon={<Pencil aria-hidden="true" />}
                        size="icon-sm"
                        onClick={() => { onEditPhase(phase); }}
                      />
                      {confirmDelete?.kind === 'phase' && confirmDelete.id === phase.id ? null : (
                        <IconButton
                          label={t('delete')}
                          icon={<Trash2 aria-hidden="true" />}
                          size="icon-sm"
                          onClick={() => { setConfirmDelete({ kind: 'phase', id: phase.id }); }}
                        />
                      )}
                    </div>
                  </div>
                  {confirmDelete?.kind === 'phase' && confirmDelete.id === phase.id ? (
                    <ConfirmDeleteRow
                      label={t('confirmDelete')}
                      actionLabel={t('confirmDeleteAction')}
                      loading={deletePhase.isPending}
                      onCancel={() => { setConfirmDelete(null); }}
                      onConfirm={() => { runDelete({ kind: 'phase', id: phase.id }); }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <GitBranch aria-hidden="true" className="size-4" />
              {t('transitionsLabel')}
            </p>
            <Button variant="ghost" size="sm" onClick={onNewRule} disabled={phases.length < 2}>
              <Plus aria-hidden="true" />
              {t('addTransition')}
            </Button>
          </div>
          {transitionRules.length === 0 ? (
            <EmptyState title={t('transitionsEmpty')} />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {transitionRules.map((rule) => {
                const from = transitionFromSummary(rule, phases);
                return (
                  <li key={rule.id} className="flex flex-col gap-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 text-sm text-fg">
                        <span>{t(from.key, from.values)}</span>
                        <span className="mx-1.5 text-fg-subtle">&rarr;</span>
                        <span>{phaseName(phases, rule.toPhaseId)}</span>
                        {!rule.isEnabled ? (
                          <Badge tone="neutral" className="ms-2">
                            {t('disabled')}
                          </Badge>
                        ) : null}
                        {rule.requiresApproval ? (
                          <Badge tone="warning" className="ms-2">
                            {t('requiresApprovalShort')}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton
                          label={t('edit')}
                          icon={<Pencil aria-hidden="true" />}
                          size="icon-sm"
                          onClick={() => { onEditRule(rule); }}
                        />
                        {confirmDelete?.kind === 'rule' && confirmDelete.id === rule.id ? null : (
                          <IconButton
                            label={t('delete')}
                            icon={<Trash2 aria-hidden="true" />}
                            size="icon-sm"
                            onClick={() => { setConfirmDelete({ kind: 'rule', id: rule.id }); }}
                          />
                        )}
                      </div>
                    </div>
                    {confirmDelete?.kind === 'rule' && confirmDelete.id === rule.id ? (
                      <ConfirmDeleteRow
                        label={t('confirmDelete')}
                        actionLabel={t('confirmDeleteAction')}
                        loading={deleteRule.isPending}
                        onCancel={() => { setConfirmDelete(null); }}
                        onConfirm={() => { runDelete({ kind: 'rule', id: rule.id }); }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Clock aria-hidden="true" className="size-4" />
              {t('slasLabel')}
            </p>
            <Button variant="ghost" size="sm" onClick={onNewSla}>
              <Plus aria-hidden="true" />
              {t('addSla')}
            </Button>
          </div>
          {slas.data === undefined ? (
            <Skeleton className="h-16" />
          ) : slas.data.length === 0 ? (
            <EmptyState title={t('slasEmpty')} />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {slas.data.map((sla) => {
                const target = formatTargetMinutes(sla.targetMinutes);
                const scope = slaScopeLabel(sla, phases, pipe.name);
                return (
                  <li key={sla.id} className="flex flex-col gap-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-fg">{sla.name}</p>
                        <p className="truncate text-xs text-fg-muted">
                          {t('slaSummary', {
                            scope: scope === '' ? pipe.name : scope,
                            value: target.value,
                            unit: t(`unit.${target.unit}`),
                          })}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!sla.isEnabled ? <Badge tone="neutral">{t('disabled')}</Badge> : null}
                        <IconButton
                          label={t('edit')}
                          icon={<Pencil aria-hidden="true" />}
                          size="icon-sm"
                          onClick={() => { onEditSla(sla); }}
                        />
                        {confirmDelete?.kind === 'sla' && confirmDelete.id === sla.id ? null : (
                          <IconButton
                            label={t('delete')}
                            icon={<Trash2 aria-hidden="true" />}
                            size="icon-sm"
                            onClick={() => { setConfirmDelete({ kind: 'sla', id: sla.id }); }}
                          />
                        )}
                      </div>
                    </div>
                    {confirmDelete?.kind === 'sla' && confirmDelete.id === sla.id ? (
                      <ConfirmDeleteRow
                        label={t('confirmDelete')}
                        actionLabel={t('confirmDeleteAction')}
                        loading={deleteSla.isPending}
                        onCancel={() => { setConfirmDelete(null); }}
                        onConfirm={() => { runDelete({ kind: 'sla', id: sla.id }); }}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}

function ConfirmDeleteRow({
  label,
  actionLabel,
  loading,
  onCancel,
  onConfirm,
}: {
  label: string;
  actionLabel: string;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const tc = useTranslations('common');
  return (
    <div className="flex items-center justify-end gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm">
      <span className="me-auto text-fg">{label}</span>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {tc('cancel')}
      </Button>
      <Button variant="danger" size="sm" loading={loading} onClick={onConfirm}>
        {actionLabel}
      </Button>
    </div>
  );
}

function phaseKindTone(kind: PhaseKind): 'neutral' | 'info' | 'success' | 'danger' {
  if (kind === 'start') return 'info';
  if (kind === 'done') return 'success';
  if (kind === 'cancelled') return 'danger';
  return 'neutral';
}

// ------------------------------------------------------------------------------------ fases ---

function PhaseForm({
  boardId,
  pipeId,
  phase,
  onDone,
}: {
  boardId: string;
  pipeId: string;
  phase?: Phase | undefined;
  onDone: () => void;
}) {
  const t = useTranslations('processes');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreatePhase(boardId, pipeId);
  const update = useUpdatePhase(boardId);
  const isEdit = phase !== undefined;

  const [name, setName] = useState(phase?.name ?? '');
  const [description, setDescription] = useState(phase?.description ?? '');
  const [kind, setKind] = useState<PhaseKind>(phase?.kind ?? 'intermediate');
  const [wipLimit, setWipLimit] = useState(phase?.wipLimit === undefined ? '' : (phase.wipLimit?.toString() ?? ''));

  const submit = async () => {
    if (name.trim() === '') {
      toast.error(t('incomplete'));
      return;
    }
    const body: PhaseInputBody = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      kind,
      requiredColumnKeys: phase?.requiredColumnKeys ?? [],
      wipLimit: wipLimit.trim() === '' ? null : Number(wipLimit),
    };
    try {
      if (isEdit) await update.mutateAsync({ id: phase.id, input: body });
      else await create.mutateAsync(body);
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('editPhaseTitle') : t('newPhaseTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
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
        <Field label={t('phaseKindLabel')}>
          <Select
            value={kind}
            options={PHASE_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
            onValueChange={(value) => {
              setKind(value as PhaseKind);
            }}
          />
        </Field>
        <Field label={t('wipLimit')} hint={t('wipLimitHint')}>
          <Input
            type="number"
            min={1}
            value={wipLimit}
            onChange={(event) => {
              setWipLimit(event.target.value);
            }}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------- regras de transição ---

const ANY_PHASE = '';

function TransitionForm({
  boardId,
  pipeId,
  phases,
  rule,
  onDone,
}: {
  boardId: string;
  pipeId: string;
  phases: Phase[];
  rule?: TransitionRule | undefined;
  onDone: () => void;
}) {
  const t = useTranslations('processes');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateTransitionRule(boardId, pipeId);
  const update = useUpdateTransitionRule(boardId);
  const isEdit = rule !== undefined;

  const [fromPhaseId, setFromPhaseId] = useState(rule?.fromPhaseId ?? ANY_PHASE);
  const [toPhaseId, setToPhaseId] = useState(rule?.toPhaseId ?? (phases[0]?.id ?? ''));
  const [requiresApproval, setRequiresApproval] = useState(rule?.requiresApproval ?? false);
  const [isEnabled, setIsEnabled] = useState(rule?.isEnabled ?? true);

  const submit = async () => {
    if (toPhaseId === '') {
      toast.error(t('incomplete'));
      return;
    }
    const body: TransitionRuleInputBody = {
      fromPhaseId: fromPhaseId === ANY_PHASE ? null : fromPhaseId,
      toPhaseId,
      requiredColumnKeys: rule?.requiredColumnKeys ?? [],
      requiresApproval,
      isEnabled,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: rule.id, input: body });
      else await create.mutateAsync(body);
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('editTransitionTitle') : t('newTransitionTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
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
        <Field label={t('fromPhase')}>
          <Select
            value={fromPhaseId}
            options={[
              { value: ANY_PHASE, label: t('anyPhase') },
              ...phases.map((phase) => ({ value: phase.id, label: phase.name })),
            ]}
            onValueChange={setFromPhaseId}
          />
        </Field>
        <Field label={t('toPhase')} required requiredLabel={tc('required')}>
          <Select
            value={toPhaseId}
            options={phases.map((phase) => ({ value: phase.id, label: phase.name }))}
            onValueChange={setToPhaseId}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={requiresApproval} onCheckedChange={setRequiresApproval} aria-label={t('requiresApproval')} />
          {t('requiresApproval')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label={t('enabledField')} />
          {t('enabledField')}
        </label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------- SLAs ---

type SlaScope = 'board' | 'pipe' | 'phase';

function scopeOf(sla: Sla | undefined): SlaScope {
  if (sla === undefined) return 'board';
  if (sla.phaseId !== null) return 'phase';
  if (sla.pipeId !== null) return 'pipe';
  return 'board';
}

function unitMinutes(unit: DurationParts['unit']): number {
  if (unit === 'hours') return 60;
  if (unit === 'days') return 60 * 24;
  return 1;
}

function SlaForm({
  boardId,
  pipe,
  phases,
  sla,
  onDone,
}: {
  boardId: string;
  pipe: { id: string };
  phases: Phase[];
  sla?: Sla | undefined;
  onDone: () => void;
}) {
  const t = useTranslations('processes');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateSla(boardId);
  const update = useUpdateSla(boardId);
  const isEdit = sla !== undefined;

  const initialTarget = formatTargetMinutes(sla?.targetMinutes ?? 480);
  const [name, setName] = useState(sla?.name ?? '');
  const [scope, setScope] = useState<SlaScope>(scopeOf(sla));
  const [phaseId, setPhaseId] = useState(sla?.phaseId ?? (phases[0]?.id ?? ''));
  const [targetValue, setTargetValue] = useState(initialTarget.value);
  const [targetUnit, setTargetUnit] = useState<DurationParts['unit']>(initialTarget.unit);
  const [warningPercent, setWarningPercent] = useState(sla?.warningPercent ?? 80);
  const [useBusinessTime, setUseBusinessTime] = useState(sla?.useBusinessTime ?? true);
  const [isEnabled, setIsEnabled] = useState(sla?.isEnabled ?? true);

  const submit = async () => {
    if (name.trim() === '' || (scope === 'phase' && phaseId === '')) {
      toast.error(t('incomplete'));
      return;
    }
    const body: SlaInputBody = {
      name: name.trim(),
      targetMinutes: Math.max(1, Math.round(targetValue * unitMinutes(targetUnit))),
      warningPercent,
      useBusinessTime,
      pipeId: scope === 'pipe' ? pipe.id : null,
      phaseId: scope === 'phase' ? phaseId : null,
      isEnabled,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: sla.id, input: body });
      else await create.mutateAsync(body);
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('editSlaTitle') : t('newSlaTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
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
        <Field label={t('slaScopeLabel')}>
          <Select
            value={scope}
            options={[
              { value: 'board', label: t('scope.board') },
              { value: 'pipe', label: t('scope.pipe') },
              { value: 'phase', label: t('scope.phase') },
            ]}
            onValueChange={(value) => {
              setScope(value as SlaScope);
            }}
          />
        </Field>
        {scope === 'phase' ? (
          <Field label={t('fromPhase')}>
            <Select
              value={phaseId}
              options={phases.map((phase) => ({ value: phase.id, label: phase.name }))}
              onValueChange={setPhaseId}
            />
          </Field>
        ) : null}
        <div className="flex items-end gap-2">
          <Field label={t('targetLabel')} className="flex-1">
            <Input
              type="number"
              min={1}
              value={targetValue}
              onChange={(event) => {
                setTargetValue(Number(event.target.value));
              }}
            />
          </Field>
          <Field label={t('targetUnitLabel')} className="w-36">
            <Select
              value={targetUnit}
              options={[
                { value: 'minutes', label: t('unit.minutes') },
                { value: 'hours', label: t('unit.hours') },
                { value: 'days', label: t('unit.days') },
              ]}
              onValueChange={(value) => {
                setTargetUnit(value as DurationParts['unit']);
              }}
            />
          </Field>
        </div>
        <Field label={t('warningPercentLabel')} hint={t('warningPercentHint')}>
          <Input
            type="number"
            min={1}
            max={100}
            value={warningPercent}
            onChange={(event) => {
              setWarningPercent(Number(event.target.value));
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={useBusinessTime} onCheckedChange={setUseBusinessTime} aria-label={t('useBusinessTime')} />
          {t('useBusinessTime')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} aria-label={t('enabledField')} />
          {t('enabledField')}
        </label>
      </div>
    </Modal>
  );
}
