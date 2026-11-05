'use client';

import { Spinner, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { useRouter } from '@/i18n/navigation';

import { isKnownProvider } from './model';
import { takePendingIntegrationWorkspace } from './pending-connect';

/** Executa uma ação uma única vez por montagem. */
function useOnce(action: () => void) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    action();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intencionalmente uma única execução
  }, []);
}

/**
 * Página-ponte do callback OAuth de integrações (ADR 0056): `GET /v1/integrations/:provider/callback`
 * (backend) redireciona para cá com `?status=ok|error&provider=...&error=...` — sem saber de qual
 * workspace a conexão partiu (o redirect é uma navegação pública de navegador, sem contexto de UI).
 * Esta página lê o workspace pendente gravado em `sessionStorage` antes do redirecionamento OAuth
 * (`rememberPendingIntegrationWorkspace`) e devolve a pessoa à aba de integrações desse workspace,
 * mostrando um toast de sucesso/erro. Sem workspace pendente (aba fechada, storage limpo), volta ao
 * início — a conexão em si já foi concluída do lado do servidor.
 */
export function IntegrationsCallbackPage() {
  const t = useTranslations('integrations');
  const params = useSearchParams();
  const router = useRouter();

  useOnce(() => {
    const status = params.get('status');
    const provider = params.get('provider') ?? '';
    const errorCode = params.get('error') ?? 'unknown';
    const workspaceId = takePendingIntegrationWorkspace();

    const providerLabel = isKnownProvider(provider) ? t(`provider.${provider}`) : provider;
    if (status === 'ok') {
      toast.success(t('callback.success', { provider: providerLabel }));
    } else {
      toast.error(t('callback.error', { provider: providerLabel, code: errorCode }));
    }

    router.replace(workspaceId === null ? '/' : `/w/${workspaceId}/settings#workspace-settings-integrations`);
  });

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center" aria-live="polite">
      <Spinner size="lg" />
      <p className="text-sm text-fg-muted">{t('callback.pending')}</p>
    </div>
  );
}
