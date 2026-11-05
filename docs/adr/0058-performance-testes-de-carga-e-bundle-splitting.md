# ADR 0058 — Performance: testes de carga, cache de metadados de board e bundle-splitting

- **Status:** Aceita
- **Data:** 2026-11-05
- **Prompt:** 16

## Contexto

O Prompt 16 pede testes de carga k6 (1000 usuários simultâneos, board de 50 mil itens, p95 da API
< 200 ms, propagação realtime < 300 ms) e otimizações de índices, cache, N+1, bundle-splitting e
prefetch. `docs/architecture.md` §5 já reservava `tools/load/` para os scripts k6 (nunca criado até
agora); o board de carga (`pnpm db:seed:large`, "Carga — 50 mil itens") e o cache de permissões
versionado no Redis (`AccessService`) já existiam desde os Prompts 2 e 3.

## Decisões

### `tools/load/` com k6, autenticação por token de API (um por VU)

- Dois scripts (`items-list.js`, `realtime.js`) seguem a estrutura já documentada em
  `docs/architecture.md`, não um diretório `load/` na raiz. Cada um escreve um resumo em
  `tools/load/results/*.json` (git-ignorado) e sai com código 1 se o p95 violar o limiar — mesmo
  espírito do `scripts/lighthouse.mjs` (`apps/web`), mas sem a dependência externa `jslib.k6.io`
  (bloqueada neste ambiente; o resumo é montado à mão em vez de `k6-summary`).
- Autenticação usa o sistema de tokens de API pessoais já existente
  (`apps/api/src/modules/api-access`, ADR 0056) — nunca sessão/cookie por VU. Um token por VU, não
  um único token compartilhado: cada token de API tem teto de 300 req/min
  (`API_TOKEN_RATE_LIMIT`, `core/rate-limit/rate-limit.ts`); com centenas de VUs simultâneas um
  único token estouraria esse teto quase de imediato, o que mediria o limitador de taxa em vez da
  API. Documentado em `tools/load/README.md`: como todos os tokens do teste pertencem ao mesmo
  usuário de demonstração, o teto *por usuário* (`RATE_LIMIT_PER_MINUTE`, 600/min por padrão)
  também precisa ser elevado só para a duração do teste — em produção, 1000 usuários reais têm 1000
  contas distintas e nunca colidiriam nesse teto.
- `realtime.js` fala Engine.IO/Socket.IO v4 diretamente sobre `k6/ws` (sem cliente Socket.IO — k6
  não tem um): abre o WebSocket, troca o pacote `CONNECT` com o access token no payload de auth,
  envia `subscribe` para a room do board e escuta `occurredAt` nos eventos recebidos — o mesmo
  cálculo que `cube_realtime_propagation_ms` (`core/observability/metrics.ts`, já existente) grava
  do lado do servidor. `tools/load/scrape-metrics.sh` lê esse histograma Prometheus para a
  validação cruzada pedida.

### Cache de metadados de board (mesmo padrão versionado do cache de permissões)

- `BoardCacheService` (`apps/api/src/core/cache/board-cache.service.ts`) replica exatamente o
  padrão já usado por `AccessService` para o cache de permissões: uma versão por board em
  `board:{boardId}:v` no Redis, incrementada a cada mutação (`invalidate`), chave de cache
  `board:{boardId}:{version}:{key}`, TTL de 60 s como rede de segurança, métricas
  `cube_board_cache_hits_total`/`cube_board_cache_misses_total` no mesmo molde de
  `cube_permission_cache_hits/misses_total`. Confirmado como lacuna real antes de implementar:
  `BoardsService.getBoard` (usado por `GET /v1/boards/:id`, aberto a cada troca de board/view) lia
  board, grupos, colunas, rótulos e opções do zero em toda requisição, sem cache algum.
- **Só a forma tenant-wide é cacheada** (linha do board, grupos, todas as definições de coluna com
  rótulos/opções) — nunca dados dependentes do usuário autenticado. `canEdit` por coluna, colunas
  ocultas por permissão/escopo de convidado e a lista de `permissions`/`itemScope` continuam
  calculados a cada requisição sobre a forma cacheada, nunca cacheados eles mesmos: cachear o DTO
  inteiro (como `getBoard` devolvia antes) vazaria o `canEdit`/visibilidade de um usuário para
  outro com papel diferente no mesmo board — um risco de segurança que esta decisão evita por
  design, não por teste. `seq` (usado pelo cliente realtime para retomar do ponto certo após
  reconectar) também fica fora do cache e é lido fresco a cada chamada, porque muda a cada evento
  do board (inclusive edição de item, muito mais frequente que mudança de definição) — cachear essa
  forma junto faria o cache invalidar a cada edição de célula, anulando o ganho.
- Invalidação explícita (não um hook central genérico) nos pontos que já mutam
  board/coluna/grupo/rótulo/opção: `ColumnsService`, `GroupsService`, `ImportExportService`,
  `StructureService.updateBoard` e `ProcessesService` (fases criam/renomeiam grupos). Considerou-se
  hookar a invalidação dentro de `DomainEvents.emit` central (um só ponto, zero chance de
  esquecer), mas isso dispararia a cada evento COM `boardId` — inclusive toda edição de item, que
  acontece ordens de magnitude mais que mudança de definição — tornando o cache quase sempre frio.
  A lista explícita de chamadas é maior, mas o cache efetivamente funciona (confirmado: só 1
  `cube_board_cache_misses_total` ao longo de dezenas de `GET /v1/boards/:id` no mesmo board
  durante os testes manuais desta sessão).

### Bundle-splitting por tipo de view com `next/dynamic`

- `apps/web/src/features/board/view-body.tsx` — o único ponto que decide qual componente de view
  renderizar — troca os oito imports estáticos (Tabela, Kanban, Calendário, Timeline, Gantt,
  Formulário, Dashboard, Workload) por `next/dynamic` com `ssr: false`, mesmo padrão já usado para
  a paleta de comandos e os diálogos do shell (`apps/web/src/features/shell/app-shell.tsx`,
  `const loadX = () => import('./x').then((m) => m.X); const X = dynamic(loadX, { ssr: false })`).
  Trocar de view agora só baixa o código da view ativa — Tabela, Kanban e Gantt são, de longe, as
  telas mais pesadas do app (virtualização, `dnd-kit`, ECharts/cálculo de caminho crítico) e cada
  uma tinha zero `next/dynamic` antes desta entrega, apesar de o board normalmente só mostrar uma
  view por vez.
- `Skeleton` (já existente em `@cube-track/ui`) como `loading` do `dynamic()` — nenhum componente
  de carregamento novo.

## Pendências (ADRs futuras ou follow-up, não cobertas aqui)

- **Ordenar/filtrar por coluna customizada em boards com dezenas de milhares de itens degrada para
  table scan** mesmo com os índices compostos existentes (`item_field_index_num_idx` e irmãos):
  confirmado com `EXPLAIN (ANALYZE, BUFFERS)` contra o board de 50 mil itens — o `LEFT JOIN` entre
  `items` e `item_field_index` (necessário porque nem todo item tem linha em `item_field_index`
  para toda coluna) impede o planner de aproveitar o índice para o `ORDER BY ... LIMIT`. Corrigir
  exige reestruturar a consulta (ex.: topo-N em duas etapas com UNION para itens sem valor) mantendo
  a paginação por cursor e os filtros combinados existentes em
  `apps/api/src/modules/work/infrastructure/item-query.ts` — não feito nesta sessão (arquivo de 655
  linhas, usado por Tabela/Kanban/dashboards/exportação, sem suíte de teste unitário dedicada ainda;
  risco maior que o orçamento de uma correção pontual de performance). Ver `tools/load/README.md`
  para o diagnóstico completo e os números medidos.
- **Ordenação padrão (sem coluna) e por `name` também fazem `Seq Scan` em boards de 50 mil itens** —
  avaliar um índice dedicado.
- **Cenário `realtime.js` não produziu números reais nesta sessão**: a chamada `subscribe` do
  gateway (`AccessService.can` → `decide()` para `'board.read'`) está retornando erro interno,
  isolado a um módulo de permissões em desenvolvimento concorrente nesta janela (ADR 0057) — fora
  do escopo e dos arquivos deste prompt.
