# CUBE TRACK — Diretrizes do frontend

Este guia vale para `apps/web` (Next.js) e `packages/ui` (design system). Decisões relacionadas: ADRs 0016, 0031–0036. Identidade visual em `docs/brand.md`.

## 1. Como rodar

```bash
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm --filter @cube-track/api build && pnpm --filter @cube-track/api start   # API :3001
pnpm --filter @cube-track/web dev                                            # web :3000 (webpack)
pnpm --filter @cube-track/ui storybook                                       # Storybook :6006
```

Login de demonstração: `ana.ribeiro@empresademo.com.br` / `CubeTrack@2026`. Também há `juliana.castro@…` (editora) e `thiago.pereira@…` (leitor).

Variáveis do web (os padrões já apontam para `localhost:3001`; se precisar, crie `apps/web/.env.local`):

| Variável                   | Uso                                                             |
| -------------------------- | --------------------------------------------------------------- |
| `API_INTERNAL_URL`         | destino do proxy same-origin `/v1/*` (rewrite do Next)          |
| `NEXT_PUBLIC_REALTIME_URL` | URL pública do Socket.IO (API em modo `embedded` ou `separate`) |

## 2. Estrutura

```
apps/web/src/
├── app/[locale]/
│   ├── (auth)/…            # telas públicas (SSG por idioma): login, signup, invite, organizations, auth/*
│   └── (app)/…             # shell autenticado (client): início, my-week, inbox, favorites, search, ai, settings, w/…/b/…
├── features/<feature>/     # componentes, hooks e chamadas de API por domínio
├── components/             # peças comuns do app (providers, page-header, seletores)
├── realtime/               # cliente Socket.IO, apply.ts (patches), presença, mutações pendentes
├── lib/                    # api client, sessão, query keys, erros
├── stores/                 # Zustand: sessão (memória), preferências (localStorage), shell (efêmero)
└── i18n/  proxy.ts         # next-intl
```

Regras:

- **Páginas são finas**: `page.tsx` só monta o componente da feature (`features/<x>/<x>-page.tsx`).
- **Componentes genéricos vão para `packages/ui`** (sem dependência de API, i18n ou Next). Componentes que conhecem o domínio ficam em `features/`.
- **Sem estilo ad-hoc repetido**: use os tokens (`bg-surface`, `text-fg-muted`, `border-border`, `bg-primary-soft`…). Nunca use hex direto em componentes.
- **Todo texto vem do i18n** (`useTranslations` / `getTranslations`); nada fica hardcoded.

## 3. Estado e dados

| Tipo de estado                            | Onde                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- |
| Dados do servidor                         | TanStack Query, com chaves de `lib/query/keys.ts` (`qk.*`)          |
| Sessão (access token, usuário)            | `stores/session.ts`, só em memória                                  |
| Preferências (tema, densidade, painel)    | `stores/preferences.ts` (`localStorage`, aplicado antes da pintura) |
| UI efêmera (diálogo aberto, paleta)       | `stores/shell.ts` ou `board/store.ts`                               |
| Filtros, ordenação e agrupamento do board | `board/store.ts` (por board)                                        |

### Chaves de query

- Tudo de um board fica sob `qk.board(id)`, que equivale a `['boards', id]`: `boardDetail`, `views`, `items`, `itemList(id, params)`.
- Coisas do usuário ficam sob `['me', …]`: `favorites`, `notifications`, `week`.
- Novas chaves entram em `qk`; chaves literais espalhadas pelo código não são permitidas.
- Queries de dados usam `enabled: useAuthenticated()`. O shell renderiza enquanto a sessão é recuperada.

### Mutações

1. Gere `mutationId = newId()`. Envie como `clientMutationId` e também como `idempotencyKey` nos POST.
2. Em `onMutate`, chame `trackMutation(mutationId)` e aplique o patch otimista (`patchItem`, `insertItem`…).
3. Em `onError`:
   - **409** (conflito LWW): aplique `problem.current` e avise com `errors.conflict`;
   - outros erros: desfaça o patch e mostre `toast.error(useErrorMessage()(erro))`.
4. Em `onSettled`, chame `releaseMutation(mutationId)`. O eco realtime de mutações pendentes é ignorado.

### Eventos realtime

- Cada tipo de evento é tratado num `case` de `realtime/apply.ts`, como função pura sobre o `QueryClient`, e precisa de teste em `apply.test.ts`.
- Atualize o cache diretamente quando o cliente sabe o resultado (LWW por `fieldVersions`). Invalide quando só o servidor sabe: listas filtradas, estrutura filtrada por permissão.
- Para receber eventos de um board, use `useBoardRealtime`/`useBoardPresence`. Eles fazem a assinatura com contagem de referências; a base de `seq` vem do GET do board.

## 4. Acessibilidade (WCAG 2.1 AA)

- **Teclado em tudo:**
  - foco visível (anel de 2 px);
  - nenhum `div` clicável: use `button` ou `Link`;
  - menus, diálogos e abas vêm do Radix, que já traz foco e ARIA corretos.
- **Nomes acessíveis:**
  - Botão só com ícone usa `IconButton` (`label` obrigatório e tooltip).
  - Se houver texto visível, o nome acessível precisa contê-lo (critério 2.5.3).
  - Iniciais de avatar são decorativas (pseudo-elemento); o nome vai em `sr-only`.
- **Formulários:**
  - `Field` liga `label`, `aria-describedby` e `aria-invalid`;
  - erros aparecem em texto e são anunciados;
  - campos obrigatórios trazem indicação textual.
- **Cor nunca é o único sinal:** status mostram o rótulo, e as cores livres passam por `accessiblePair`.
- **Arrastar e soltar na árvore:** pelo teclado, Espaço pega, setas movem, Espaço solta e Esc cancela. As instruções e anúncios são lidos por leitores de tela.
- **Movimento:** respeite `prefers-reduced-motion`; as animações do `packages/ui` já respeitam.
- **Testes:**
  - `packages/ui` roda axe em cada componente (`test/a11y.ts`);
  - o E2E `a11y-responsive.spec.ts` roda axe nas telas base, nos temas claro e escuro.

## 5. Responsividade

Mobile-first a partir de 360 px:

| Largura   | Layout                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| < 768 px  | barra superior (menu do workspace em drawer, logo, usuário) e barra de navegação inferior (Início, Minha semana, Inbox, Busca, Mais) |
| ≥ 768 px  | trilho de ícones fixo                                                                                                                |
| ≥ 1024 px | painel do workspace fixo, recolhível com `[`                                                                                         |

Na barra de ferramentas do board, abaixo de 768 px os botões mostram só o ícone (o rótulo continua acessível) e a barra quebra em linhas. Exportar e atualizar ficam no menu `⋯`. Sem rolagem horizontal da página; tabelas largas rolam dentro do próprio contêiner.

## 6. Atalhos de teclado

| Atalho       | Ação                                        |
| ------------ | ------------------------------------------- |
| `Ctrl/⌘ + K` | Paleta de comandos (páginas, boards, ações) |
| `?`          | Lista de atalhos                            |
| `[`          | Mostrar/ocultar painel do workspace         |
| `G` → `H`    | Ir para Início                              |
| `G` → `W`    | Ir para Minha semana                        |
| `G` → `I`    | Ir para Inbox                               |
| `G` → `F`    | Ir para Favoritos                           |
| `G` → `S`    | Ir para Busca                               |
| `N`          | Novo item (no board)                        |
| `/`          | Pesquisar no board                          |

- A fonte única dos atalhos é `features/shell/shortcuts.ts` (`SHORTCUTS`); o diálogo de ajuda e a paleta leem dela.
- Atalhos de uma tecla não disparam com foco em campos de texto.
- Para um atalho novo: adicione a entrada em `SHORTCUTS`, o rótulo em `shortcuts.*` nos três idiomas e o handler em `useGlobalShortcuts`/`useBoardShortcuts`.

## 7. i18n

- Mensagens em `packages/i18n/src/messages/{pt-BR,en,es}.ts`. O pt-BR é a fonte e define o tipo.
- O teste de paridade falha se faltar uma chave ou um argumento ICU.
- **URLs:**
  - pt-BR não tem prefixo; en e es usam `/en` e `/es`.
  - O idioma escolhido fica no cookie `ct_locale` e prevalece sobre um prefixo digitado manualmente.
  - Troque o idioma pelo seletor, que atualiza o cookie.
- **Formatação** só pelos helpers de `@cube-track/i18n`: `formatDate` (datas de negócio em UTC), `formatDateTime`, `formatNumber`, `formatCurrency` (BRL), `formatPercent` e `formatRelativeTime`. Dinheiro e UST chegam como decimal string; nunca converta para `number` para exibir.

## 8. PWA

- Manifesto em `app/manifest.ts` e service worker em `public/sw.js`, registrado só em produção.
- O SW nunca cacheia `/v1` nem o WebSocket.
- Ao mudar a estratégia de cache, incremente `VERSION` no `sw.js`. Os clientes recebem o aviso "Nova versão disponível".

## 9. Performance

- **Orçamento:** Lighthouse ≥ 90 em performance e acessibilidade nas telas base. Rode `pnpm --filter @cube-track/web lighthouse` com a API e o web em produção.
- **Carregue sob demanda o que não aparece na primeira pintura:** overlays, editores pesados e bibliotecas de gráfico. Use `next/dynamic` ou `import()`.
- **Imports do `@cube-track/shared` no navegador:** use os subpaths sem Zod (`@cube-track/shared/realtime`, `@cube-track/shared/fractional-index`). Do índice, importe só tipos.
- **Telas públicas** devem ser pré-renderizadas por completo. Evite `useSearchParams` no caminho crítico: leia `window.location` no evento.
- **CLS:**
  - skeletons com o mesmo layout final;
  - listas de altura variável entram juntas;
  - espaço reservado para avatares e badges.
- **Links de listas grandes** (árvore, resultados) usam `prefetch={false}`.

### Resultado atual (ADR 0036)

| Tela         | Mobile | Desktop | Acessibilidade |
| ------------ | ------ | ------- | -------------- |
| Login        | 93     | 100     | 100            |
| Início       | 73     | 100     | 100            |
| Board        | 63     | 99      | 100            |
| Minha semana | 73     | 99      | 100            |

As telas autenticadas no perfil mobile simulado ainda ficam abaixo de 90, porque o conteúdo depende da sessão recuperada no cliente. O plano para o Prompt 16 está na ADR 0036.

## 10. Testes

| Tipo              | Onde                              | Comando                                        |
| ----------------- | --------------------------------- | ---------------------------------------------- |
| Unitário (lógica) | `apps/web/src/**/*.test.ts`       | `pnpm --filter @cube-track/web test`           |
| Componentes + axe | `packages/ui/src/**/*.test.tsx`   | `pnpm --filter @cube-track/ui test`            |
| E2E (Playwright)  | `apps/web/e2e/*.spec.ts`          | `pnpm --filter @cube-track/web test:e2e`       |
| Storybook (build) | `packages/ui/src/stories`         | `pnpm --filter @cube-track/ui build-storybook` |
| Lighthouse        | `apps/web/scripts/lighthouse.mjs` | `pnpm --filter @cube-track/web lighthouse`     |

Os E2E:

- usam o banco de demonstração (`db:reset && db:seed`);
- sobem a API e o web de produção (`playwright.config.ts`);
- fazem login pela UI em cada teste e limpam as chaves `rl:*` do Redis antes;
- incluem cenários com **dois navegadores** (presença e propagação de itens).

Fluxos críticos novos precisam de E2E, e componentes novos do `packages/ui` precisam de story, teste e axe.
