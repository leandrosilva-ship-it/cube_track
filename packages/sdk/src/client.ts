import type { operations } from './generated/schema.js';
import {
  HttpClient,
  type HttpClientOptions,
  type HttpMethod,
  type JsonBodyOf,
  type OperationAt,
  type PathsWithMethod,
  type QueryParamsOf,
  type RequestArgs,
  type SuccessResponseOf,
} from './http.js';

export type { HttpClientOptions } from './http.js';

/** Corpo JSON de uma operação do OpenAPI gerado, pelo `operationId` (ex.: `Body<'MeTokens_create'>`). */
export type Body<Name extends keyof operations> = JsonBodyOf<operations[Name]>;
/** Parâmetros de query de uma operação do OpenAPI gerado, pelo `operationId`. */
export type Query<Name extends keyof operations> = QueryParamsOf<operations[Name]>;
/** Resposta 2xx de uma operação do OpenAPI gerado, pelo `operationId`. */
export type Response<Name extends keyof operations> = SuccessResponseOf<operations[Name]>;

/**
 * Cliente tipado da API pública do CUBE TRACK (ADR 0056). Cobre, com métodos de conveniência, a
 * superfície do Prompt 15 — tokens de API, apps OAuth, webhooks, templates, importadores e
 * integrações — e expõe `request()` como escape hatch tipado para QUALQUER rota documentada em
 * `/v1/docs` (veja `docs/openapi.json`), inclusive as de prompts anteriores (boards, itens, etc.).
 */
export function createClient(options: HttpClientOptions) {
  const http = new HttpClient(options);

  /** Escape hatch genérico, tipado por `path`+`method` a partir do OpenAPI completo da API. */
  function request<Method extends HttpMethod, Path extends PathsWithMethod<Method>>(
    path: Path,
    method: Method,
    ...rest: RequestArgs<Path, Method>
  ): Promise<SuccessResponseOf<OperationAt<Path, Method>>> {
    return http.request(path, method, ...rest);
  }

  return {
    request,

    /** Tokens de API pessoais (`GET/POST /v1/me/tokens`, `DELETE /v1/me/tokens/{id}`). */
    me: {
      tokens: {
        list: () => http.request('/v1/me/tokens', 'get'),
        create: (body: Body<'MeTokens_create'>) => http.request('/v1/me/tokens', 'post', { body }),
        revoke: (id: string) =>
          http.request('/v1/me/tokens/{id}', 'delete', { params: { path: { id } } }),
      },
    },

    /** Apps OAuth `client_credentials` do tenant (requer escopo/permissão `api_tokens.manage`). */
    oauthApps: {
      list: () => http.request('/v1/oauth-apps', 'get'),
      create: (body: Body<'OAuthApps_create'>) => http.request('/v1/oauth-apps', 'post', { body }),
      update: (id: string, body: Body<'OAuthApps_update'>) =>
        http.request('/v1/oauth-apps/{id}', 'patch', { params: { path: { id } }, body }),
      remove: (id: string) =>
        http.request('/v1/oauth-apps/{id}', 'delete', { params: { path: { id } } }),
    },

    /** Troca `client_id`/`client_secret` por um token de API (`grant_type=client_credentials`). */
    oauth: {
      token: (body: Body<'OAuthToken_issue'>) => http.request('/v1/oauth/token', 'post', { body }),
    },

    /** Webhooks de saída: assinatura por board/workspace, reenvio de entregas (ADR 0051/0056). */
    webhooks: {
      listForBoard: (boardId: string) =>
        http.request('/v1/boards/{boardId}/webhooks', 'get', { params: { path: { boardId } } }),
      createForBoard: (boardId: string, body: Body<'Webhooks_createForBoard'>) =>
        http.request('/v1/boards/{boardId}/webhooks', 'post', {
          params: { path: { boardId } },
          body,
        }),
      listForWorkspace: (workspaceId: string) =>
        http.request('/v1/workspaces/{workspaceId}/webhooks', 'get', {
          params: { path: { workspaceId } },
        }),
      createForWorkspace: (workspaceId: string, body: Body<'Webhooks_createForWorkspace'>) =>
        http.request('/v1/workspaces/{workspaceId}/webhooks', 'post', {
          params: { path: { workspaceId } },
          body,
        }),
      update: (id: string, body: Body<'Webhooks_update'>) =>
        http.request('/v1/webhooks/{id}', 'patch', { params: { path: { id } }, body }),
      remove: (id: string) =>
        http.request('/v1/webhooks/{id}', 'delete', { params: { path: { id } } }),
      regenerateSecret: (id: string) =>
        http.request('/v1/webhooks/{id}/regenerate-secret', 'post', { params: { path: { id } } }),
      deliveries: (id: string, query?: Query<'WebhookDeliveries_list'>) =>
        http.request('/v1/webhooks/{id}/deliveries', 'get', {
          params: query === undefined ? { path: { id } } : { path: { id }, query },
        }),
      resendDelivery: (id: string) =>
        http.request('/v1/webhook-deliveries/{id}/resend', 'post', { params: { path: { id } } }),
    },

    /** Galeria de templates (board/workspace/dashboard/automação/formulário) e aplicação. */
    templates: {
      list: (query?: Query<'Templates_list'>) =>
        http.request('/v1/templates', 'get', query === undefined ? {} : { params: { query } }),
      create: (body: Body<'Templates_create'>) => http.request('/v1/templates', 'post', { body }),
      get: (id: string) => http.request('/v1/templates/{id}', 'get', { params: { path: { id } } }),
      update: (id: string, body: Body<'Templates_update'>) =>
        http.request('/v1/templates/{id}', 'patch', { params: { path: { id } }, body }),
      remove: (id: string) =>
        http.request('/v1/templates/{id}', 'delete', { params: { path: { id } } }),
      /** `body` é opcional aqui (overrides de aplicação); a API exige o campo, mas aceita `{}`. */
      apply: (id: string, body: Body<'Templates_apply'> = {}) =>
        http.request('/v1/templates/{id}/apply', 'post', { params: { path: { id } }, body }),
      saveBoardAsTemplate: (boardId: string, body: Body<'SaveBoardAsTemplate_saveAsTemplate'>) =>
        http.request('/v1/boards/{boardId}/save-as-template', 'post', {
          params: { path: { boardId } },
          body,
        }),
    },

    /** Importação em background (CSV/Monday/Trello/Jira/Pipefy): preview → mapeamento → commit. */
    imports: {
      preview: (boardId: string, body: Body<'BoardImports_preview'>) =>
        http.request('/v1/boards/{boardId}/imports/preview', 'post', {
          params: { path: { boardId } },
          body,
        }),
      create: (boardId: string, body: Body<'BoardContent_importPreview'>) =>
        http.request('/v1/boards/{boardId}/imports', 'post', {
          params: { path: { boardId } },
          body,
        }),
      get: (importJobId: string) =>
        http.request('/v1/imports/{importJobId}', 'get', { params: { path: { importJobId } } }),
      updateMapping: (importJobId: string, body: Body<'Imports_updateMapping'>) =>
        http.request('/v1/imports/{importJobId}/mapping', 'patch', {
          params: { path: { importJobId } },
          body,
        }),
      commit: (importJobId: string) =>
        http.request('/v1/imports/{importJobId}/commit', 'post', {
          params: { path: { importJobId } },
        }),
    },

    /** Integrações de terceiros por workspace: Google/Microsoft (OAuth), Slack/Teams/GitHub/GitLab/Azure DevOps (BYOK). */
    integrations: {
      listForWorkspace: (workspaceId: string) =>
        http.request('/v1/workspaces/{workspaceId}/integrations', 'get', {
          params: { path: { workspaceId } },
        }),
      disconnect: (connectionId: string) =>
        http.request('/v1/integrations/{connectionId}', 'delete', {
          params: { path: { connectionId } },
        }),
      connect: {
        /** Inicia o OAuth do Google (Calendar/Drive/Gmail) — devolve a `authorizationUrl` para redirecionar o usuário. */
        google: (workspaceId: string, body: Body<'GoogleMicrosoft_connectGoogle'>) =>
          http.request('/v1/workspaces/{workspaceId}/integrations/google/connect', 'post', {
            params: { path: { workspaceId } },
            body,
          }),
        /** Inicia o OAuth do Microsoft 365 (Calendar/OneDrive/Graph) — devolve a `authorizationUrl`. */
        microsoft: (workspaceId: string, body: Body<'GoogleMicrosoft_connectMicrosoft'>) =>
          http.request('/v1/workspaces/{workspaceId}/integrations/microsoft/connect', 'post', {
            params: { path: { workspaceId } },
            body,
          }),
        /** BYOK: Incoming Webhook URL + signing secret do próprio app Slack do tenant. */
        slack: (workspaceId: string, body: Body<'Chat_connectSlack'>) =>
          http.request('/v1/workspaces/{workspaceId}/integrations/slack/connect', 'post', {
            params: { path: { workspaceId } },
            body,
          }),
        /** BYOK: Incoming Webhook URL do próprio conector do Microsoft Teams (sem signing secret). */
        teams: (workspaceId: string, body: Body<'Chat_connectTeams'>) =>
          http.request('/v1/workspaces/{workspaceId}/integrations/teams/connect', 'post', {
            params: { path: { workspaceId } },
            body,
          }),
        /** BYOK: segredo do próprio webhook GitHub do tenant (HMAC-SHA256). */
        github: (workspaceId: string, body: Body<'DevEvents_connectGithub'>) =>
          http.request('/v1/workspaces/{workspaceId}/integrations/github/connect', 'post', {
            params: { path: { workspaceId } },
            body,
          }),
        /** BYOK: token do próprio webhook GitLab do tenant. */
        gitlab: (workspaceId: string, body: Body<'DevEvents_connectGitlab'>) =>
          http.request('/v1/workspaces/{workspaceId}/integrations/gitlab/connect', 'post', {
            params: { path: { workspaceId } },
            body,
          }),
        /** BYOK: usuário/senha do próprio webhook Azure DevOps do tenant (HTTP Basic Auth). */
        azureDevops: (workspaceId: string, body: Body<'DevEvents_connectAzureDevOps'>) =>
          http.request('/v1/workspaces/{workspaceId}/integrations/azure-devops/connect', 'post', {
            params: { path: { workspaceId } },
            body,
          }),
      },
    },
  };
}

export type Client = ReturnType<typeof createClient>;
