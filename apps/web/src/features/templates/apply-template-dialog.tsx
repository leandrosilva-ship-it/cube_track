'use client';

import { Button, Field, Input, Modal, Select, Switch, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useTree, useWorkspaces } from '@/features/workspace/hooks';
import type { Template } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useApplyTemplate } from './hooks';
import {
  allowsNameOverride,
  buildApplyBody,
  emptyApplyTemplateState,
  needsBoardPicker,
  needsWorkspacePicker,
} from './model';

/** Formulário de aplicação de um template (ADR 0056) — os campos exigidos variam por `kind`; ver
 * `features/templates/model.ts` (`buildApplyBody`). */
export function ApplyTemplateDialog({ template, onDone }: { template: Template; onDone: () => void }) {
  const t = useTranslations('templates');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const workspaces = useWorkspaces();
  const apply = useApplyTemplate();
  const [state, setState] = useState(emptyApplyTemplateState());

  const showWorkspacePicker = needsWorkspacePicker(template.kind, state);
  const showBoardPicker = needsBoardPicker(template.kind);
  const showNameOverride = allowsNameOverride(template.kind);
  const tree = useTree(showBoardPicker && state.workspaceId !== '' ? state.workspaceId : null);
  const body = buildApplyBody(template.kind, state);

  const submit = async () => {
    if (body === null) {
      toast.error(t('apply.incomplete'));
      return;
    }
    try {
      await apply.mutateAsync({ id: template.id, body });
      toast.success(t('apply.success', { name: template.name }));
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('apply.title', { name: template.name })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            {tc('cancel')}
          </Button>
          <Button loading={apply.isPending} disabled={body === null} onClick={() => void submit()}>
            {tc('apply')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {template.kind === 'workspace' ? (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={state.useNewWorkspace}
              onCheckedChange={(checked) => {
                setState((current) => ({ ...current, useNewWorkspace: checked }));
              }}
            />
            {t('apply.newWorkspaceToggle')}
          </label>
        ) : null}

        {template.kind === 'workspace' && state.useNewWorkspace ? (
          <Field label={t('apply.newWorkspaceName')} required requiredLabel={tc('required')}>
            <Input
              value={state.newWorkspaceName}
              onChange={(event) => {
                const value = event.target.value;
                setState((current) => ({ ...current, newWorkspaceName: value }));
              }}
            />
          </Field>
        ) : null}

        {showWorkspacePicker ? (
          <Field label={t('apply.workspaceLabel')} required requiredLabel={tc('required')}>
            <Select
              value={state.workspaceId}
              placeholder={t('apply.workspacePlaceholder')}
              options={(workspaces.data ?? []).map((workspace) => ({ value: workspace.id, label: workspace.name }))}
              onValueChange={(value) => {
                setState((current) => ({ ...current, workspaceId: value, boardId: '' }));
              }}
            />
          </Field>
        ) : null}

        {showBoardPicker ? (
          <Field
            label={t('apply.boardLabel')}
            required
            requiredLabel={tc('required')}
            hint={state.workspaceId === '' ? t('apply.pickWorkspaceFirst') : undefined}
          >
            <Select
              value={state.boardId}
              disabled={state.workspaceId === ''}
              placeholder={t('apply.boardPlaceholder')}
              options={(tree.data?.boards ?? []).map((board) => ({ value: board.id, label: board.name }))}
              onValueChange={(value) => {
                setState((current) => ({ ...current, boardId: value }));
              }}
            />
          </Field>
        ) : null}

        {showNameOverride ? (
          <Field label={t('apply.nameOverrideLabel')} hint={t('apply.nameOverrideHint')}>
            <Input
              value={state.name}
              placeholder={template.name}
              onChange={(event) => {
                const value = event.target.value;
                setState((current) => ({ ...current, name: value }));
              }}
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
