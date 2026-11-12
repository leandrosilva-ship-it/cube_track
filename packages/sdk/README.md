# @cube-track/sdk

Cliente TypeScript tipado para a **API pública** do CUBE PROJECT (Prompt 15, ADR 0056): tokens de API,
apps OAuth, webhooks, templates, importadores e integrações de terceiros. Os tipos de requisição/resposta
são gerados a partir do documento OpenAPI publicado pela própria API (`docs/openapi.json`), então o
cliente nunca fica fora de sincronia com os contratos reais.

> **Este pacote não é publicado num registro npm público.** Dentro do monorepo ele é consumido como
> qualquer outro workspace (`"@cube-track/sdk": "workspace:*"`). Para usá-lo **fora** do monorepo (um
> script de integração, um serviço de terceiro), rode `pnpm --filter @cube-track/sdk build` e copie
> `packages/sdk/dist/` (mais o `package.json`) para onde for consumido, ou publique-o manualmente no seu
> próprio registro privado — não há pipeline de publicação automática configurado neste projeto.

## Instalação

Dentro do monorepo:

```jsonc
// package.json de quem consome
{ "dependencies": { "@cube-track/sdk": "workspace:*" } }
```

Fora do monorepo, depois de rodar `pnpm --filter @cube-track/sdk build`:

```bash
npm install /caminho/para/cube_track/packages/sdk
# ou publique dist/ no seu registro privado e instale normalmente:
npm install @cube-track/sdk
```

## Início rápido

1. Crie um token de API pessoal pelo produto (**Configurações → API e integrações**) ou via
   `POST /v1/me/tokens` (requer sessão de login — um token de API nunca cria outro):

   ```bash
   curl -X POST https://sua-instancia.cubetrack.com/v1/me/tokens \
     -H 'content-type: application/json' --cookie "..." \
     -d '{"name": "Script de relatório", "scopes": ["boards:read", "items:read"]}'
   # resposta traz `token` (ctk_...) em texto puro UMA vez só — guarde-o agora.
   ```

2. Use o token no cliente:

   ```ts
   import { createClient, ApiError, isApiError } from '@cube-track/sdk';

   const client = createClient({
     baseUrl: 'https://sua-instancia.cubetrack.com',
     token: process.env.CUBE_TRACK_TOKEN!, // ctk_...
   });

   const { data: templates } = await client.templates.list({ scope: 'public' });

   try {
     await client.webhooks.resendDelivery(deliveryId);
   } catch (error) {
     if (isApiError(error, 404)) {
       console.error('Entrega não encontrada:', error.problem.detail);
     } else if (error instanceof ApiError) {
       console.error(`Erro ${String(error.status)} (${error.code}): ${error.message}`);
     } else {
       throw error;
     }
   }
   ```

## O que tem um método de conveniência pronto

Cobertura tipada e com assinatura dedicada para a superfície do **Prompt 15**:

| Área            | Métodos                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Tokens pessoais | `client.me.tokens.list() / .create(body) / .revoke(id)`                                                                                    |
| Apps OAuth      | `client.oauthApps.list() / .create(body) / .update(id, body) / .remove(id)`                                                                |
| Troca OAuth     | `client.oauth.token(body)` (`grant_type=client_credentials`)                                                                               |
| Webhooks        | `client.webhooks.listForBoard/createForBoard/listForWorkspace/createForWorkspace/update/remove/regenerateSecret/deliveries/resendDelivery` |
| Templates       | `client.templates.list/create/get/update/remove/apply`, `client.templates.saveBoardAsTemplate`                                             |
| Importadores    | `client.imports.preview/create/get/updateMapping/commit`                                                                                   |
| Integrações     | `client.integrations.listForWorkspace/disconnect`, `client.integrations.connect.{google,microsoft,slack,teams,github,gitlab,azureDevops}`  |

## O resto da API: o escape hatch `request()`

O CUBE PROJECT tem centenas de rotas de prompts anteriores (boards, itens, colunas, dashboards, etc. —
veja `/v1/docs` na sua instância, ou `docs/openapi.json` neste repositório) que este SDK não embrulha
uma a uma. Todas elas continuam **totalmente tipadas** através do escape hatch genérico:

```ts
// GET /v1/boards/{boardId}/items?limit=50 — path, query e resposta tipados a partir do OpenAPI,
// mesmo sem um método `client.items.list(...)` dedicado.
const { data: items } = await client.request('/v1/boards/{boardId}/items', 'get', {
  params: { path: { boardId }, query: { limit: 50 } },
});
```

`request(path, method, options)` é tipado contra o `paths`/`operations` gerados: `path` só aceita rotas
que suportam o `method` escolhido, `options.params`/`options.body` tornam-se obrigatórios quando a rota
exige, e o retorno é a união dos corpos de resposta 2xx documentados.

## Tratamento de erros

Toda resposta não-2xx vira uma `ApiError` (nunca um `Error` genérico), carregando o problema RFC 7807
(`application/problem+json`) devolvido pela API:

```ts
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails; // { type?, title?, status, detail?, code?, requestId?, errors?, ... }
  get code(): string; // problem.code, ou 'error'
  fieldErrors(): Record<string, string>; // erros de validação por campo (body.name → name)
}
```

Falhas sem resposta do servidor (DNS, timeout, conexão recusada) viram `NetworkError`, nunca `ApiError`.

## Desenvolvimento deste pacote

```bash
pnpm --filter @cube-track/api openapi:export      # atualiza docs/openapi.json (build da API antes)
pnpm --filter @cube-track/sdk generate            # regenera src/generated/schema.ts a partir dele
pnpm --filter @cube-track/sdk typecheck
pnpm --filter @cube-track/sdk lint
pnpm --filter @cube-track/sdk test
pnpm --filter @cube-track/sdk build                # gera dist/ (ESM + .d.ts) via tsup
```

`src/generated/schema.ts` é gerado e versionado (como `docs/openapi.json`) — rode `generate` de novo
sempre que o contrato da API mudar, e confira o diff antes de commitar.

### Por que `scripts/generate.mjs` não chama `openapi-typescript` direto

O exportador OpenAPI da API usa, para os poucos tipos recursivos do produto (condições de filtro de
views/saved-filters, `showWhen` de campos de formulário condicionais), um `$defs` **local**, aninhado
dentro do próprio schema de cada rota — não um `$defs`/`components.schemas` na raiz do documento. Como
`$ref: "#/$defs/..."` é um JSON Pointer absoluto (resolvido a partir da raiz do documento, nunca do
escopo aninhado), ferramentas que validam o documento de forma estrita (Redocly, usado por
`openapi-typescript`) não conseguem resolvê-lo nessa forma. `scripts/generate.mjs` faz o _hoist_ desse
`$defs` para a raiz (confirmando antes que todas as ocorrências são idênticas) só na cópia em memória
usada para gerar os tipos deste pacote — `docs/openapi.json` e `apps/api` não são alterados.
