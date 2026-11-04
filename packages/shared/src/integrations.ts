/**
 * Integrações de terceiros (Prompt 15, ADR 0056): toda credencial é BYOK (bring your own key) — a
 * organização cadastra seu próprio app/token/webhook, nunca uma credencial compartilhada da
 * plataforma (mesma filosofia do `ai_settings` do Prompt 14 e do segredo de webhook do Prompt 10).
 *
 * GitHub/GitLab/Azure DevOps: a integração é só de ENTRADA — um webhook configurado pelo próprio
 * repositório aponta para a nossa API (segredo compartilhado para validar a assinatura), e nós só
 * interpretamos o evento para vincular um item e atualizar seu status; nunca chamamos de volta a API
 * do provedor (não precisa de token de escrita no provedor, só o segredo do webhook).
 *
 * Slack/Teams: notificação de saída via webhook de entrada do canal (o mesmo conceito de "Incoming
 * Webhook"/"Connector" que Slack e Teams já oferecem nativamente) — reaproveita o MESMO motor de
 * entrega de webhooks do Prompt 10 (HMAC/retry/log), só o corpo da mensagem muda de formato
 * (`slackNotificationBlocks`/`teamsAdaptiveCard`). "Criar item por comando" (Slack) e link preview
 * exigem um endpoint de entrada adicional (slash command / unfurl) autenticado pelo segredo de
 * assinatura do app Slack cadastrado pelo tenant.
 *
 * Google Workspace/Microsoft 365: única integração desta lista que precisa de OAuth de verdade (agir
 * como o usuário no calendário/Drive/e-mail dele) — o tenant cadastra seu próprio app OAuth (client
 * id/secret do Google Cloud Console / Azure AD) e cada usuário faz o consentimento individualmente;
 * ver `integration_connections` (packages/db/src/schema/integrations.ts).
 */

export const INTEGRATION_PROVIDERS = ['google', 'microsoft', 'slack', 'teams', 'github', 'gitlab', 'azure_devops'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

/** Como a credencial da integração é obtida — determina quais campos `integration_connections` usa. */
export const INTEGRATION_AUTH_KINDS = ['oauth', 'webhook_secret'] as const;
export type IntegrationAuthKind = (typeof INTEGRATION_AUTH_KINDS)[number];

export const INTEGRATION_AUTH_KIND_BY_PROVIDER: Record<IntegrationProvider, IntegrationAuthKind> = {
  google: 'oauth',
  microsoft: 'oauth',
  slack: 'webhook_secret',
  teams: 'webhook_secret',
  github: 'webhook_secret',
  gitlab: 'webhook_secret',
  azure_devops: 'webhook_secret',
};

// --------------------------------------------------------------------- vínculo commit/PR → item ---

/** Referências de item encontradas num texto livre (mensagem de commit, título de PR/MR): tokens
 * `#algo` (ex.: `#OS-2026-0042`, o valor de uma coluna `auto_id`) ou um UUID de item por extenso. */
export function extractItemReferences(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/#([a-zA-Z0-9][\w.-]{1,40})/g)) refs.add(match[1] ?? '');
  for (const match of text.matchAll(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g)) {
    refs.add(match[0]);
  }
  refs.delete('');
  return [...refs];
}

export type DevEventKind = 'push' | 'pull_request_opened' | 'pull_request_merged' | 'pull_request_closed';

export interface NormalizedDevEvent {
  provider: 'github' | 'gitlab' | 'azure_devops';
  kind: DevEventKind;
  repo: string;
  title: string;
  url: string;
  authorName: string;
  /** Mensagens de commit (push) ou título+descrição (PR/MR) — onde procurar referências de item. */
  searchableText: string[];
}

/** Normaliza o payload de webhook do GitHub (`push`/`pull_request`) para o formato comum. Lança se o
 * payload não tiver o formato mínimo esperado (o chamador decide como responder — 400, não 500). */
export function normalizeGithubEvent(eventType: string, payload: Record<string, unknown>): NormalizedDevEvent | null {
  const repo = (payload.repository as { full_name?: unknown } | undefined)?.full_name;
  if (typeof repo !== 'string') throw new Error('Payload do GitHub sem repository.full_name.');
  if (eventType === 'push') {
    const commits = Array.isArray(payload.commits) ? (payload.commits as { message?: unknown; url?: unknown; author?: { name?: unknown } }[]) : [];
    const messages = commits.map((commit) => (typeof commit.message === 'string' ? commit.message : '')).filter((entry) => entry !== '');
    if (messages.length === 0) return null;
    const last = commits[commits.length - 1];
    return {
      provider: 'github',
      kind: 'push',
      repo,
      title: messages[messages.length - 1] ?? '',
      url: typeof last?.url === 'string' ? last.url : `https://github.com/${repo}`,
      authorName: typeof last?.author?.name === 'string' ? last.author.name : 'GitHub',
      searchableText: messages,
    };
  }
  if (eventType === 'pull_request') {
    const pr = payload.pull_request as { title?: unknown; body?: unknown; html_url?: unknown; merged?: unknown; user?: { login?: unknown } } | undefined;
    if (pr === undefined || typeof pr.title !== 'string') throw new Error('Payload do GitHub sem pull_request.title.');
    const action = payload.action;
    const kind: DevEventKind = action === 'closed' ? (pr.merged === true ? 'pull_request_merged' : 'pull_request_closed') : 'pull_request_opened';
    return {
      provider: 'github',
      kind,
      repo,
      title: pr.title,
      url: typeof pr.html_url === 'string' ? pr.html_url : `https://github.com/${repo}`,
      authorName: typeof pr.user?.login === 'string' ? pr.user.login : 'GitHub',
      searchableText: [pr.title, typeof pr.body === 'string' ? pr.body : ''],
    };
  }
  return null;
}

/** Normaliza o payload de webhook do GitLab (`Push Hook`/`Merge Request Hook`). */
export function normalizeGitlabEvent(payload: Record<string, unknown>): NormalizedDevEvent | null {
  const objectKind = payload.object_kind;
  const project = payload.project as { path_with_namespace?: unknown; web_url?: unknown } | undefined;
  const repo = project?.path_with_namespace;
  if (typeof repo !== 'string') throw new Error('Payload do GitLab sem project.path_with_namespace.');
  if (objectKind === 'push') {
    const commits = Array.isArray(payload.commits) ? (payload.commits as { message?: unknown; url?: unknown; author?: { name?: unknown } }[]) : [];
    const messages = commits.map((commit) => (typeof commit.message === 'string' ? commit.message : '')).filter((entry) => entry !== '');
    if (messages.length === 0) return null;
    const last = commits[commits.length - 1];
    return {
      provider: 'gitlab',
      kind: 'push',
      repo,
      title: messages[messages.length - 1] ?? '',
      url: typeof last?.url === 'string' ? last.url : (typeof project?.web_url === 'string' ? project.web_url : ''),
      authorName: typeof last?.author?.name === 'string' ? last.author.name : 'GitLab',
      searchableText: messages,
    };
  }
  if (objectKind === 'merge_request') {
    const attrs = payload.object_attributes as { title?: unknown; description?: unknown; url?: unknown; action?: unknown; state?: unknown } | undefined;
    if (attrs === undefined || typeof attrs.title !== 'string') throw new Error('Payload do GitLab sem object_attributes.title.');
    const kind: DevEventKind = attrs.state === 'merged' ? 'pull_request_merged' : attrs.state === 'closed' ? 'pull_request_closed' : 'pull_request_opened';
    const user = payload.user as { name?: unknown } | undefined;
    return {
      provider: 'gitlab',
      kind,
      repo,
      title: attrs.title,
      url: typeof attrs.url === 'string' ? attrs.url : '',
      authorName: typeof user?.name === 'string' ? user.name : 'GitLab',
      searchableText: [attrs.title, typeof attrs.description === 'string' ? attrs.description : ''],
    };
  }
  return null;
}

/** Normaliza o payload de webhook (Service Hooks) do Azure DevOps (`git.push`/`git.pullrequest.*`). */
export function normalizeAzureDevOpsEvent(payload: Record<string, unknown>): NormalizedDevEvent | null {
  const eventType = payload.eventType;
  const resource = payload.resource as Record<string, unknown> | undefined;
  if (resource === undefined) throw new Error('Payload do Azure DevOps sem resource.');
  const repository = resource.repository as { name?: unknown; project?: { name?: unknown } } | undefined;
  const repo = typeof repository?.name === 'string' ? repository.name : typeof repository?.project?.name === 'string' ? repository.project.name : 'repositório';
  if (eventType === 'git.push') {
    const commits = Array.isArray(resource.commits) ? (resource.commits as { comment?: unknown; url?: unknown; author?: { name?: unknown } }[]) : [];
    const messages = commits.map((commit) => (typeof commit.comment === 'string' ? commit.comment : '')).filter((entry) => entry !== '');
    if (messages.length === 0) return null;
    const last = commits[commits.length - 1];
    return {
      provider: 'azure_devops',
      kind: 'push',
      repo,
      title: messages[messages.length - 1] ?? '',
      url: typeof last?.url === 'string' ? last.url : '',
      authorName: typeof last?.author?.name === 'string' ? last.author.name : 'Azure DevOps',
      searchableText: messages,
    };
  }
  if (typeof eventType === 'string' && eventType.startsWith('git.pullrequest.')) {
    const title = resource.title;
    if (typeof title !== 'string') throw new Error('Payload do Azure DevOps sem resource.title.');
    const status = resource.status;
    const kind: DevEventKind = eventType === 'git.pullrequest.merged' || status === 'completed' ? 'pull_request_merged' : status === 'abandoned' ? 'pull_request_closed' : 'pull_request_opened';
    const createdBy = resource.createdBy as { displayName?: unknown } | undefined;
    return {
      provider: 'azure_devops',
      kind,
      repo,
      title,
      url: typeof resource.url === 'string' ? resource.url : '',
      authorName: typeof createdBy?.displayName === 'string' ? createdBy.displayName : 'Azure DevOps',
      searchableText: [title, typeof resource.description === 'string' ? resource.description : ''],
    };
  }
  return null;
}

// ------------------------------------------------------------------------ mensagens de chat ---

export interface ChatNotification {
  title: string;
  body: string;
  url: string | null;
}

/** Slack Block Kit — corpo compatível com um Incoming Webhook do Slack. */
export function slackNotificationBlocks(notification: ChatNotification): Record<string, unknown> {
  return {
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${notification.title}*\n${notification.body}` } },
      ...(notification.url === null ? [] : [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Abrir no CUBE TRACK' }, url: notification.url }] }]),
    ],
  };
}

/** Adaptive Card — corpo compatível com um Incoming Webhook (connector) do Microsoft Teams. */
export function teamsAdaptiveCard(notification: ChatNotification): Record<string, unknown> {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: notification.title, weight: 'Bolder', wrap: true },
            { type: 'TextBlock', text: notification.body, wrap: true },
          ],
          ...(notification.url === null
            ? {}
            : { actions: [{ type: 'Action.OpenUrl', title: 'Abrir no CUBE TRACK', url: notification.url }] }),
        },
      },
    ],
  };
}
