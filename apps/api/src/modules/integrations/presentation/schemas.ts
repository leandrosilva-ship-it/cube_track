import { INTEGRATION_PROVIDERS } from '@cube-track/shared/integrations';
import { z } from 'zod';

export const WorkspaceParams = z.object({ workspaceId: z.uuid() });
export const ConnectionParams = z.object({ connectionId: z.uuid() });
export const ExternalFileParams = z.object({ id: z.uuid() });
export const ItemParams = z.object({ itemId: z.uuid() });

export const GoogleMicrosoftProviderParams = z.object({ provider: z.enum(['google', 'microsoft']) });

export const ConnectionSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  provider: z.enum(INTEGRATION_PROVIDERS),
  authKind: z.enum(['oauth', 'webhook_secret']),
  userId: z.uuid().nullable(),
  connectedBy: z.uuid().nullable(),
  isActive: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// --------------------------------------------------------------------------------- Google/Microsoft ---

export const GoogleMicrosoftConnectBody = z.object({
  clientId: z.string().trim().min(1).max(300),
  clientSecret: z.string().trim().min(1).max(500),
  /** Opt-in (ADR 0056): sem endpoint dedicado de preferências nesta entrega, então entra junto do
   * cadastro do app — pode ser reenviado num novo `connect` para ligar/desligar. */
  emailToItemEnabled: z.boolean().default(false),
});
export const AuthorizationUrlResponse = z.object({ authorizationUrl: z.string() });

export const OAuthCallbackQuery = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(256),
  error: z.string().max(200).optional(),
});

export const ExternalFileLinkBody = z.object({
  connectionId: z.uuid(),
  externalFileId: z.string().trim().min(1).max(300),
});
export const ExternalFileLinkSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  connectionId: z.uuid(),
  externalFileId: z.string(),
  name: z.string(),
  url: z.string(),
  mimeType: z.string().nullable(),
  createdAt: z.string(),
});

// ------------------------------------------------------------------------------------- Slack/Teams ---

export const SlackConnectBody = z.object({
  incomingWebhookUrl: z.url().max(2000),
  signingSecret: z.string().trim().min(8).max(300),
  /** Board padrão para o comando `/cubetrack create` (ADR 0056) — sem ele, o comando responde só com
   * uma mensagem orientando a configurar. */
  defaultBoardId: z.uuid().optional(),
});
export const TeamsConnectBody = z.object({
  incomingWebhookUrl: z.url().max(2000),
});

// ------------------------------------------------------------------------------ GitHub/GitLab/Azure ---

export const WebhookSecretConnectBody = z.object({
  webhookSecret: z.string().trim().min(8).max(300),
});
export const AzureDevOpsConnectBody = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().trim().min(8).max(300),
});

export const DevEventLinkSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  connectionId: z.uuid(),
  kind: z.string(),
  repo: z.string(),
  title: z.string(),
  url: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});
