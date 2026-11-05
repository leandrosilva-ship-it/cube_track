'use client';

import { Badge, Button, Checkbox, Field, Input, Skeleton, toast } from '@cube-track/ui';
import { Cloud, MessageSquare, Workflow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { IntegrationConnection, IntegrationProvider } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import {
  useConnectAzureDevOps,
  useConnectDevWebhook,
  useConnectOAuthProvider,
  useConnectSlack,
  useConnectTeams,
  useDisconnectIntegration,
  useWorkspaceIntegrations,
} from './hooks';
import { buildDevWebhookUrl, buildSlackEventsUrl, CHAT_PROVIDERS, DEV_PROVIDERS, OAUTH_PROVIDERS } from './model';
import { rememberPendingIntegrationWorkspace } from './pending-connect';

/** Base pública da API (ADR 0056) — só para montar as URLs de webhook de ENTRADA que o provedor
 * externo chama direto (nunca através do proxy same-origin de /v1 do Next). */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const CATEGORY_ICON = { oauth: Cloud, chat: MessageSquare, dev: Workflow } as const;

function CopyField({ label, value }: { label: string; value: string }) {
  const tc = useTranslations('common');
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-sunken p-2">
      <p className="text-xs text-fg-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              toast.success(tc('copied'));
            });
          }}
        >
          {tc('copy')}
        </Button>
      </div>
    </div>
  );
}

function OAuthConnectForm({ workspaceId, provider }: { workspaceId: string; provider: 'google' | 'microsoft' }) {
  const t = useTranslations('integrations');
  const errorMessage = useErrorMessage();
  const connect = useConnectOAuthProvider(workspaceId, provider);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [emailToItemEnabled, setEmailToItemEnabled] = useState(false);

  const submit = async () => {
    if (clientId.trim() === '' || clientSecret.trim() === '') {
      toast.error(t('connect.incomplete'));
      return;
    }
    try {
      const { authorizationUrl } = await connect.mutateAsync({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        emailToItemEnabled,
      });
      rememberPendingIntegrationWorkspace(workspaceId);
      window.location.href = authorizationUrl;
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-xs text-fg-muted">{t(`connect.${provider}Hint`)}</p>
      <Field label={t('connect.clientIdLabel')}>
        <Input value={clientId} onChange={(event) => { setClientId(event.target.value); }} />
      </Field>
      <Field label={t('connect.clientSecretLabel')}>
        <Input type="password" value={clientSecret} onChange={(event) => { setClientSecret(event.target.value); }} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={emailToItemEnabled} onCheckedChange={(checked) => { setEmailToItemEnabled(checked === true); }} />
        {t('connect.emailToItemLabel')}
      </label>
      <Button size="sm" loading={connect.isPending} className="self-start" onClick={() => void submit()}>
        {t('connect.authorize')}
      </Button>
    </div>
  );
}

function SlackConnectForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('integrations');
  const errorMessage = useErrorMessage();
  const connect = useConnectSlack(workspaceId);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [signingSecret, setSigningSecret] = useState('');

  const submit = async () => {
    if (webhookUrl.trim() === '' || signingSecret.trim() === '') {
      toast.error(t('connect.incomplete'));
      return;
    }
    try {
      await connect.mutateAsync({ incomingWebhookUrl: webhookUrl.trim(), signingSecret: signingSecret.trim() });
      toast.success(t('connect.success'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-xs text-fg-muted">{t('connect.slackHint')}</p>
      <Field label={t('connect.incomingWebhookUrlLabel')}>
        <Input value={webhookUrl} onChange={(event) => { setWebhookUrl(event.target.value); }} />
      </Field>
      <Field label={t('connect.signingSecretLabel')}>
        <Input type="password" value={signingSecret} onChange={(event) => { setSigningSecret(event.target.value); }} />
      </Field>
      <Button size="sm" loading={connect.isPending} className="self-start" onClick={() => void submit()}>
        {t('connect.save')}
      </Button>
    </div>
  );
}

function TeamsConnectForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('integrations');
  const errorMessage = useErrorMessage();
  const connect = useConnectTeams(workspaceId);
  const [webhookUrl, setWebhookUrl] = useState('');

  const submit = async () => {
    if (webhookUrl.trim() === '') {
      toast.error(t('connect.incomplete'));
      return;
    }
    try {
      await connect.mutateAsync({ incomingWebhookUrl: webhookUrl.trim() });
      toast.success(t('connect.success'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-xs text-fg-muted">{t('connect.teamsHint')}</p>
      <Field label={t('connect.incomingWebhookUrlLabel')}>
        <Input value={webhookUrl} onChange={(event) => { setWebhookUrl(event.target.value); }} />
      </Field>
      <Button size="sm" loading={connect.isPending} className="self-start" onClick={() => void submit()}>
        {t('connect.save')}
      </Button>
    </div>
  );
}

function DevWebhookConnectForm({ workspaceId, provider }: { workspaceId: string; provider: 'github' | 'gitlab' }) {
  const t = useTranslations('integrations');
  const errorMessage = useErrorMessage();
  const connect = useConnectDevWebhook(workspaceId, provider);
  const [secret, setSecret] = useState('');

  const submit = async () => {
    if (secret.trim() === '') {
      toast.error(t('connect.incomplete'));
      return;
    }
    try {
      await connect.mutateAsync({ webhookSecret: secret.trim() });
      toast.success(t('connect.success'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-xs text-fg-muted">{t(`connect.${provider}Hint`)}</p>
      <Field label={t(provider === 'github' ? 'connect.webhookSecretLabel' : 'connect.webhookTokenLabel')}>
        <Input type="password" value={secret} onChange={(event) => { setSecret(event.target.value); }} />
      </Field>
      <Button size="sm" loading={connect.isPending} className="self-start" onClick={() => void submit()}>
        {t('connect.save')}
      </Button>
    </div>
  );
}

function AzureDevOpsConnectForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('integrations');
  const errorMessage = useErrorMessage();
  const connect = useConnectAzureDevOps(workspaceId);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async () => {
    if (username.trim() === '' || password.trim() === '') {
      toast.error(t('connect.incomplete'));
      return;
    }
    try {
      await connect.mutateAsync({ username: username.trim(), password: password.trim() });
      toast.success(t('connect.success'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <p className="text-xs text-fg-muted">{t('connect.azure_devopsHint')}</p>
      <Field label={t('connect.usernameLabel')}>
        <Input value={username} onChange={(event) => { setUsername(event.target.value); }} />
      </Field>
      <Field label={t('connect.passwordLabel')}>
        <Input type="password" value={password} onChange={(event) => { setPassword(event.target.value); }} />
      </Field>
      <Button size="sm" loading={connect.isPending} className="self-start" onClick={() => void submit()}>
        {t('connect.save')}
      </Button>
    </div>
  );
}

function ProviderRow({
  workspaceId,
  provider,
  connection,
}: {
  workspaceId: string;
  provider: IntegrationProvider;
  connection: IntegrationConnection | undefined;
}) {
  const t = useTranslations('integrations');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const disconnect = useDisconnectIntegration(workspaceId);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const isConnected = connection?.isActive === true;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="font-medium text-fg">{t(`provider.${provider}`)}</p>
          {isConnected ? <Badge tone="success">{t('connected')}</Badge> : <Badge tone="neutral">{t('notConnected')}</Badge>}
        </div>
        {isConnected ? (
          confirmDisconnect ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setConfirmDisconnect(false); }}>
                {tc('cancel')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                loading={disconnect.isPending}
                onClick={() => {
                  disconnect.mutate(connection.id, {
                    onSuccess: () => { setConfirmDisconnect(false); },
                    onError: (error) => { toast.error(errorMessage(error)); },
                  });
                }}
              >
                {t('confirmDisconnectAction')}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => { setConfirmDisconnect(true); }}>
              {t('disconnect')}
            </Button>
          )
        ) : (
          <Button size="sm" variant="secondary" onClick={() => { setConnecting((current) => !current); }}>
            {t('connect.action')}
          </Button>
        )}
      </div>

      {isConnected && provider === 'slack' ? (
        <CopyField label={t('connect.inboundUrlLabel')} value={buildSlackEventsUrl(API_BASE_URL, connection.id)} />
      ) : null}
      {isConnected && (provider === 'github' || provider === 'gitlab' || provider === 'azure_devops') ? (
        <CopyField label={t('connect.inboundUrlLabel')} value={buildDevWebhookUrl(API_BASE_URL, provider, connection.id)} />
      ) : null}

      {!isConnected && connecting ? (
        provider === 'google' || provider === 'microsoft' ? (
          <OAuthConnectForm workspaceId={workspaceId} provider={provider} />
        ) : provider === 'slack' ? (
          <SlackConnectForm workspaceId={workspaceId} />
        ) : provider === 'teams' ? (
          <TeamsConnectForm workspaceId={workspaceId} />
        ) : provider === 'azure_devops' ? (
          <AzureDevOpsConnectForm workspaceId={workspaceId} />
        ) : (
          <DevWebhookConnectForm workspaceId={workspaceId} provider={provider} />
        )
      ) : null}
    </li>
  );
}

function ProviderGroup({
  title,
  category,
  providers,
  workspaceId,
  connections,
}: {
  title: string;
  category: 'oauth' | 'chat' | 'dev';
  providers: readonly IntegrationProvider[];
  workspaceId: string;
  connections: IntegrationConnection[];
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {providers.map((provider) => (
          <ProviderRow
            key={provider}
            workspaceId={workspaceId}
            provider={provider}
            connection={connections.find((entry) => entry.provider === provider)}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Integrações de terceiros do workspace (ADR 0056) — toda credencial é BYOK. Entrada na página de
 * configurações do workspace (`workspace-settings-page.tsx`), já gated por `canManageWorkspace`: o
 * DTO da árvore do workspace não expõe uma permissão `integrations.manage` dedicada, então esta
 * seção usa o mesmo gate da página; o backend continua sendo a autoridade final (403 em uso indevido).
 */
export function IntegrationsSection({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('integrations');
  const connections = useWorkspaceIntegrations(workspaceId);

  if (connections.isError) return null;
  if (connections.data === undefined) return <Skeleton className="h-48" />;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-fg-muted">{t('description')}</p>
      <ProviderGroup
        title={t('categoryOAuth')}
        category="oauth"
        providers={OAUTH_PROVIDERS}
        workspaceId={workspaceId}
        connections={connections.data}
      />
      <ProviderGroup
        title={t('categoryChat')}
        category="chat"
        providers={CHAT_PROVIDERS}
        workspaceId={workspaceId}
        connections={connections.data}
      />
      <ProviderGroup
        title={t('categoryDev')}
        category="dev"
        providers={DEV_PROVIDERS}
        workspaceId={workspaceId}
        connections={connections.data}
      />
    </div>
  );
}
