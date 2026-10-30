'use client';

import { OPTIONAL_WORKSPACE_MODULES, type OptionalWorkspaceModule } from '@cube-track/shared';
import { Button, Checkbox, EmptyState, Field, Input, Select, Skeleton, Textarea, toast } from '@cube-track/ui';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import type { Workspace } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useTree, useUpdateWorkspace, useWorkspaces } from './hooks';

export interface WorkspaceSettingsPageProps {
  workspaceId: string;
}

function isOptionalModule(value: string): value is OptionalWorkspaceModule {
  return (OPTIONAL_WORKSPACE_MODULES as readonly string[]).includes(value);
}

function WorkspaceSettingsForm({ workspace }: { workspace: Workspace }) {
  const t = useTranslations('workspaceSettings');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const update = useUpdateWorkspace(workspace.id);

  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [icon, setIcon] = useState(workspace.icon ?? '');
  const [color, setColor] = useState(workspace.color ?? '');
  const [visibility, setVisibility] = useState(workspace.visibility);
  const [modules, setModules] = useState<OptionalWorkspaceModule[]>(workspace.enabledModules.filter(isOptionalModule));

  const toggleModule = (module: OptionalWorkspaceModule, checked: boolean) => {
    setModules((current) => (checked ? [...current, module] : current.filter((entry) => entry !== module)));
  };

  const save = async () => {
    if (name.trim() === '') return;
    try {
      await update.mutateAsync({
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        icon: icon.trim() === '' ? null : icon.trim(),
        color: color.trim() === '' ? null : color.trim(),
        visibility,
        enabledModules: ['core', ...modules],
      });
      toast.success(t('saved'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6 px-4 sm:px-8">
      <section className="flex flex-col gap-3">
        <Field label={t('name')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label={t('description')}>
          <Textarea value={description} onChange={(event) => { setDescription(event.target.value); }} rows={3} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('icon')}>
            <Input value={icon} onChange={(event) => { setIcon(event.target.value); }} />
          </Field>
          <Field label={t('color')}>
            <Input value={color} placeholder="#4252d9" onChange={(event) => { setColor(event.target.value); }} />
          </Field>
        </div>
        <Field label={t('visibility')}>
          <Select
            value={visibility}
            onValueChange={(value) => { setVisibility(value as 'open' | 'closed'); }}
            options={[
              { value: 'open', label: t('visibilityOptions.open') },
              { value: 'closed', label: t('visibilityOptions.closed') },
            ]}
          />
        </Field>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-fg">{t('modules.title')}</h2>
        <p className="text-sm text-fg-muted">{t('modules.description')}</p>
        <ul className="flex flex-col gap-2 rounded-lg border border-border p-3">
          {OPTIONAL_WORKSPACE_MODULES.map((module) => (
            <li key={module} className="flex items-center gap-2">
              <Checkbox
                id={`workspace-module-${module}`}
                checked={modules.includes(module)}
                onCheckedChange={(value) => { toggleModule(module, value === true); }}
              />
              <label htmlFor={`workspace-module-${module}`} className="text-sm">
                {t(`modules.items.${module}`)}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={update.isPending} disabled={name.trim() === ''}>
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Configurações do workspace (nome, aparência, visibilidade e módulos opcionais — ADR 0017/0054).
 * Diferente de `settings` (configuração da CONTA do usuário): aqui é o workspace inteiro, e só quem
 * tem `workspace.manage` (resolvido em `tree.canManageWorkspace`) pode editar.
 */
export function WorkspaceSettingsPage({ workspaceId }: WorkspaceSettingsPageProps) {
  const t = useTranslations('workspaceSettings');
  const workspaces = useWorkspaces();
  const tree = useTree(workspaceId);
  const workspace = workspaces.data?.find((entry) => entry.id === workspaceId);
  const canManage = tree.data?.canManageWorkspace ?? false;

  if (tree.data !== undefined && !canManage) {
    return (
      <div className="flex flex-col gap-6 pb-10">
        <PageHeader title={t('pageTitle')} />
        <div className="px-4 sm:px-8">
          <EmptyState icon={<Lock aria-hidden="true" />} title={t('forbidden')} />
        </div>
      </div>
    );
  }

  if (workspace === undefined || tree.data === undefined) {
    return (
      <div className="flex flex-col gap-6 px-4 pb-10 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-10">
      <PageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />
      <WorkspaceSettingsForm key={workspace.id} workspace={workspace} />
    </div>
  );
}
