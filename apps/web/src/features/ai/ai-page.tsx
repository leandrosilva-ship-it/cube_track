'use client';

import { Button, EmptyState, Skeleton } from '@cube-track/ui';
import { ArrowRight, Settings, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { PageHeader } from '@/components/common/page-header';
import { Link } from '@/i18n/navigation';

import { useMe } from '../shell/hooks';
import { useWorkspaces } from '../workspace/hooks';

/**
 * Entrada global de IA (ADR 0055/Prompt 14): como todo recurso de IA de verdade (assistente,
 * previsões, agentes, aprovações) é por board e não existe endpoint agregado entre workspaces, esta
 * página funciona como um hub — link para a configuração (quem tem `ai.manage`) e a lista dos
 * workspaces com o módulo `ai` habilitado, de onde a pessoa abre um board e usa o botão "IA" no
 * cabeçalho.
 */
export function AiPage() {
  const t = useTranslations('ai');
  const th = useTranslations('ai.hub');
  const me = useMe();
  const workspaces = useWorkspaces();
  const canManage = me.data?.tenant.permissions.includes('ai.manage') === true;
  const aiWorkspaces = (workspaces.data ?? []).filter((workspace) => workspace.enabledModules.includes('ai'));

  return (
    <div className="pb-10">
      <PageHeader title={t('title')} />
      <div className="flex max-w-2xl flex-col gap-6 px-4 sm:px-8">
        <p className="text-sm text-fg-muted">{t('description')}</p>

        {canManage ? (
          <section className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Settings className="size-4 text-primary" aria-hidden="true" />
                {th('settingsCardTitle')}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">{th('settingsCardDescription')}</p>
            </div>
            <Button asChild variant="secondary" size="sm">
              <Link href="/settings#settings-ai">
                {th('settingsCardAction')}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-fg">{th('workspacesTitle')}</h2>
          {workspaces.data === undefined ? (
            <Skeleton className="h-24" />
          ) : aiWorkspaces.length === 0 ? (
            <EmptyState icon={<Sparkles aria-hidden="true" />} title={th('workspacesEmpty')} />
          ) : (
            <>
              <ul className="grid gap-2 sm:grid-cols-2">
                {aiWorkspaces.map((workspace) => (
                  <li
                    key={workspace.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3"
                  >
                    <span className="min-w-0 truncate font-medium text-fg">{workspace.name}</span>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/w/${workspace.id}`}>
                        {th('openWorkspace')}
                        <ArrowRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-fg-subtle">{th('workspacesHint')}</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
