import type { IntegrationProvider } from '@/lib/api/types';

/**
 * Helpers puros das integrações de terceiros (ADR 0056). Sem I/O — testável sem rede.
 *
 * `INTEGRATION_PROVIDERS`/`INTEGRATION_AUTH_KIND_BY_PROVIDER` são cópias locais das constantes em
 * `packages/shared/src/integrations.ts` (fonte da verdade): aquele módulo importa `node:crypto` no
 * topo do arquivo (verificação de assinatura de webhook) — inseguro para o bundle do navegador.
 * Mantemos as listas em sincronia manualmente, mesmo raciocínio de `features/api-access/model.ts`.
 */
export const INTEGRATION_PROVIDERS = [
  'google',
  'microsoft',
  'slack',
  'teams',
  'github',
  'gitlab',
  'azure_devops',
] as const;

export const OAUTH_PROVIDERS: readonly IntegrationProvider[] = ['google', 'microsoft'];
export const CHAT_PROVIDERS: readonly IntegrationProvider[] = ['slack', 'teams'];
export const DEV_PROVIDERS: readonly IntegrationProvider[] = ['github', 'gitlab', 'azure_devops'];

export type IntegrationCategory = 'oauth' | 'chat' | 'dev';

export function isKnownProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

export function categoryOf(provider: IntegrationProvider): IntegrationCategory {
  if ((OAUTH_PROVIDERS as readonly string[]).includes(provider)) return 'oauth';
  if ((CHAT_PROVIDERS as readonly string[]).includes(provider)) return 'chat';
  return 'dev';
}

/** Normaliza a URL pública da API (sem barra no final) antes de montar uma URL de webhook de entrada. */
function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** URL que o app Slack do tenant precisa chamar (Events API/slash command) — ver
 * `apps/api/src/modules/integrations/presentation/chat.controller.ts`. */
export function buildSlackEventsUrl(apiBaseUrl: string, connectionId: string): string {
  return `${trimTrailingSlash(apiBaseUrl)}/v1/integrations/slack/${connectionId}/events`;
}

/** URL do webhook de entrada de GitHub/GitLab/Azure DevOps — ver
 * `apps/api/src/modules/integrations/presentation/dev-events.controller.ts`. */
export function buildDevWebhookUrl(
  apiBaseUrl: string,
  provider: 'github' | 'gitlab' | 'azure_devops',
  connectionId: string,
): string {
  return `${trimTrailingSlash(apiBaseUrl)}/v1/integrations/${provider}/${connectionId}/webhook`;
}
