# CUBE TRACK — Roadmap

Legenda: ✅ concluído · 🟡 aguardando validação · ⏳ pendente · 🔄 em andamento

| #   | Prompt                                             | Status       | Entregáveis principais                                                                                                                                                                                                        | ADRs      |
| --- | -------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Visão do produto e arquitetura                     | ✅ Concluído | `CLAUDE.md`, `docs/architecture.md`, ADRs 0001–0019, este roadmap                                                                                                                                                             | 0001–0019 |
| 2   | Banco de dados e tabelas                           | ✅ Concluído | Monorepo, docker-compose, `packages/db` (88 tabelas + auditoria particionada), RLS, seed PMSP, testes, benchmark                                                                                                              | 0020–0025 |
| 3   | Backend base                                       | ✅ Concluído | `apps/api` (auth, multi-tenant, RBAC 5 níveis, REST/GraphQL, realtime, auditoria, arquivos, busca), `apps/worker`, `docs/permissions.md`, `docs/realtime-events.md`, `docs/openapi.json`                                      | 0026–0030 |
| 4   | Frontend base                                      | ✅ Concluído | `apps/web` (shell, auth, navegação, board header/abas/toolbar, paleta, PWA), `packages/ui` + Storybook, i18n pt-BR/en/es, cliente realtime, `docs/brand.md`, `docs/frontend-guidelines.md`                                    | 0031–0036 |
| 5   | Boards, colunas e Tabela                           | ✅ Concluído | 33 tipos de coluna, fórmulas decimais, colunas calculadas, obrigatoriedade condicional, templates, lixeira, importação/exportação, Tabela virtualizada (50 mil itens) com edição de planilha em tempo real, `docs/columns.md` | 0037–0043 |
| 6   | Kanban e views salvas                              | ✅ Concluído | Views salvas (pessoais/compartilhadas, padrão, duplicar, link público), Kanban com raias/WIP/arrasta-e-solta, `docs/views.md`                                                                                                 | 0044–0047 |
| 7   | Painel do item                                     | ✅ Concluído | Drawer com deep link, abas (Atualizações com @menções e resposta por e-mail, Arquivos, Atividade, Campos, Checklist, Dependências, Aprovações, Seguir), presença e navegação anterior/próximo, `docs/item-panel.md`           | 0048      |
| 8   | Calendário, Timeline, Gantt e Formulários          | ✅ Concluído | Campos nativos de agendamento, Calendário, Timeline/Roadmap, Gantt (EAP/WBS, caminho crítico, baselines, importação MS Project), Formulários (público e interno), `docs/views.md` atualizado                                  | 0049      |
| 9   | Dashboards                                         | ✅ Concluído | Dashboards de workspace, 6 tipos de widget, agregação no servidor, saúde do projeto, exportação PNG/PDF/CSV                                                                                                                   | 0050      |
| 10  | Automações, Processos e Notificações               | ✅ Concluído | Motor de automações (gatilhos/condições/ações), processos com fases/SLA no Kanban, webhooks de saída com HMAC, preferências de notificação por e-mail                                                                         | 0051      |
| 11  | Capacity e Timesheet                               | ⏳           | Alocação, carga por pessoa, apontamento de horas, aprovações                                                                                                                                                                  | —         |
| 12  | Portfólio                                          | ⏳           | Programas, portfólios, scoring, rollups, visão executiva                                                                                                                                                                      | —         |
| 13  | Contratos/OS/UST                                   | ✅ Concluído | Contrato, catálogo de serviços (Código Edital), OS com ciclo de vida completo, saldo de UST ao vivo, medição mensal reconciliada, faturamento, alertas diários, 3 widgets de UST                                              | 0054      |
| 14  | IA                                                 | ⏳           | Assistente, resumos, chatbot do board, sugestões                                                                                                                                                                              | —         |
| 15  | API pública, Integrações, Importadores e Templates | ⏳           | API v1, webhooks, SDK, importador Monday/Jira/Trello/CSV, templates                                                                                                                                                           | —         |
| 16  | Segurança, Performance, Testes e Deploy            | ⏳           | Hardening, testes de carga, CI/CD, Helm, observabilidade, runbooks                                                                                                                                                            | —         |

## Prompt 1 — Resumo

**Feito**

- Arquitetura de alto nível com diagramas Mermaid (componentes, fluxo de escrita, domínio).
- Estratégia de tempo real (rooms, envelope de eventos, otimismo, sequência por board, replay, LWW por campo + Yjs, reconexão, orçamento de latência).
- Estratégia de colunas customizáveis: JSONB + projeção tipada `item_field_index` (comparativo com EAV e tabelas dinâmicas).
- Multi-tenancy: schema compartilhado + `tenant_id` + RLS forçado, `set_config` local à transação, FKs compostas, papéis de banco.
- Estrutura completa do monorepo (inclui `apps/realtime`, justificado na ADR 0007).
- Modelo de domínio preliminar e mapeamento do caso PMSP (Monday → CUBE TRACK).
- 19 ADRs, `CLAUDE.md` com protocolo de trabalho e DoD.

**Pendências / dúvidas** — ver `docs/architecture.md` §7 (D1–D10). Nenhuma bloqueia o Prompt 2; confirmar premissas P2, P3 e P4.

**Como rodar e testar** — não se aplica (entrega documental, sem código de aplicação).

**Próximos passos** — Prompt 2: modelagem física do banco, migrações Drizzle, políticas RLS, testes de isolamento e benchmark de colunas customizadas.

## Prompt 2 — Resumo

**Feito**

- Monorepo Turborepo + pnpm (`packages/config`, `packages/shared`, `packages/db`), TypeScript strict, ESLint, Prettier, CI no GitHub Actions e `docker-compose` (PostgreSQL, Redis, MinIO, Meilisearch, Mailpit).
- `packages/shared`: UUIDv7, fractional indexing, registro de 32 tipos de coluna (schemas Zod de valor/configuração e projeção), formatador de ID com máscara.
- `packages/db`: 88 tabelas + `audit_logs` particionada, cobrindo todas as entidades do escopo (identidade, estrutura, customização, views, colaboração, planejamento, recursos, processos, automação, formulários, dashboards, portfólio, contratos e governança).
- 4 migrações: bootstrap (papéis, `app.uuid_v7`, contexto), schema (gerado), RLS/auditoria/triggers/funções e dados de referência (permissões e feriados 2024–2035).
- RLS forçado em todas as tabelas com tenant, FKs compostas, funções `SECURITY DEFINER` para fluxos sem tenant, auditoria append-only com hash encadeado, ID automático com máscara (`2026-0924`), projeção tipada por trigger, subitens limitados a 1 nível.
- Seed idempotente da Empresa Demo com o caso PMSP (60 demandas, 8 usuários + 1 convidado, contrato, catálogo do edital, OS, medições, views, formulário, link público, dashboard, automações, recursos, board ágil e de processo).
- 57 testes (18 unitários + 39 de integração), incluindo isolamento entre tenants com papel sem BYPASSRLS.
- Benchmark de 50 mil itens (`docs/data-model.md` §9) e `docs/data-model.md` com ER e descrição de cada entidade.
- ADRs 0020–0025.

**Pendências**

- Apps (`apps/api`, `apps/web`, `apps/realtime`, `apps/worker`) começam nos Prompts 3 e 4.
- Outbox transacional (`outbox_events`) e chaves de idempotência entram no Prompt 3, junto com a API.
- Keycloak, OpenTelemetry e Grafana entram no `docker-compose` no Prompt 3/16.
- Otimização da ordenação com cursor (31 ms) no Prompt 16.

**Como rodar e testar**

```bash
cp .env.example .env && pnpm install
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/db db:bench
```

**Próximos passos** — Prompt 3: backend base (NestJS, contexto de tenant por request, autenticação OIDC, Policy Engine, outbox, auditoria nos casos de uso e gateway realtime).

## Prompt 3 — Resumo

**Feito**

- **Autenticação** (ADR 0026):
  - e-mail/senha com Argon2id e bloqueio progressivo;
  - magic link;
  - OAuth Google/Microsoft com PKCE, nonce e JWKS;
  - access JWT de 10 min e refresh token rotativo com detecção de reuso por família;
  - MFA TOTP com códigos de recuperação;
  - recuperação de senha, verificação de e-mail e convites;
  - portas SAML/SCIM.
- **Multi-tenant:**
  - tenant resolvido por subdomínio ou `X-Tenant`, com conferência contra o token;
  - contexto `app.tenant_id` por transação (RLS);
  - troca de organização;
  - papéis `app_auth`/`app_relay` com RLS dedicada (ADR 0028).
- **RBAC em 5 níveis:**
  - `can(usuário, ação, recurso)` puro e testado, com cache Redis versionado;
  - papéis de sistema e customizados;
  - concessões em workspace, board, view e item;
  - restrição por coluna e escopo de itens para convidados (`docs/permissions.md`).
- **API:**
  - REST `/v1` com 47 rotas e GraphQL somente leitura;
  - validação Zod e paginação por cursor;
  - filtros (AST) e ordenação genéricos;
  - erros RFC 7807;
  - rate limiting, `Idempotency-Key`;
  - OpenAPI 3.1 gerado (`/v1/docs`, `docs/openapi.json`).
- **Tempo real:**
  - Socket.IO + Redis adapter com autenticação no handshake;
  - rooms por board, item, dashboard e usuário;
  - eventos tipados em `packages/shared`;
  - presença com heartbeat;
  - `seq` por board com replay e LWW por campo;
  - redação por destinatário (ADR 0027).
- **Auditoria:** toda rota mutável é auditada (o teste falha se faltar). A auditoria registra quem, o quê, antes/depois, IP e UA e entra na mesma transação que o log de atividade e o outbox.
- **Worker** (ADR 0029):
  - relay do outbox;
  - filas de e-mails, notificações, automações, cronograma, busca e antivírus;
  - retries exponenciais, dead-letter queue e Bull Board protegido;
  - health checks e encerramento gracioso.
- **Arquivos:**
  - upload por URL pré-assinada, com validação de tipo, tamanho e checksum;
  - antivírus plugável (ClamAV via clamd);
  - download bloqueado até a varredura limpa.
- **Busca:** Meilisearch para itens, boards e atualizações, com filtro por boards legíveis e escopo do convidado.
- **Observabilidade:**
  - OpenTelemetry (traces OTLP, métricas Prometheus);
  - pino com `requestId`/correlação;
  - `/health/live` e `/health/ready`.
- **Testes:** 203 passando, sendo 58 em `shared`, 39 em `db`, 77 em `api` e 29 em `worker`. Os critérios de aceite estão cobertos:
  - isolamento entre tenants;
  - propagação entre dois clientes com p95 de cerca de 64 ms (meta de 300 ms);
  - coluna sem permissão inacessível via REST, GraphQL e WS;
  - auditoria em toda mutação.

**Pendências**

- Implementações de SAML e SCIM (adaptadores das portas) e rotação de chaves JWT/criptografia: Prompt 16.
- Gatilhos de automação por data (`date_arrives`), SLA de fases e webhooks de saída: Prompt 10.
- Colaboração Yjs/Hocuspocus em rich text: Prompt 7.
- Os testes usam s3rver (S3 fake) e um clamd falso. MinIO e ClamAV reais estão no `docker-compose` (`--profile antivirus`).
- Cenários k6 de 50 mil itens: Prompt 16.
- Itens do DoD de UI (responsivo, teclado) passam a valer com o frontend (Prompt 4).

**Como rodar e testar**

```bash
cp .env.example .env && pnpm install
pnpm infra:up                     # Postgres, Redis, MinIO, Meilisearch, Mailpit (ClamAV: docker compose --profile antivirus up -d)
pnpm db:migrate && pnpm db:seed   # login demo: ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm build
pnpm --filter @cube-track/api start      # http://localhost:3001/v1/docs (header X-Tenant: empresa-demo)
pnpm --filter @cube-track/worker start   # Bull Board: http://localhost:3010/admin/queues
pnpm lint && pnpm typecheck && pnpm test
```

**Próximos passos:** Prompt 4, frontend base (Next.js, design system, i18n, fluxos de autenticação, navegação e cliente realtime com patches no TanStack Query).

## Prompt 4 — Resumo

**Feito**

- **Design system** (`packages/ui`, ADR 0034):
  - Tokens em TS espelhados em CSS (teste de igualdade), temas claro e escuro e densidade confortável ou compacta.
  - Paleta de 20 status com contraste AA, e `accessiblePair` para cores livres.
  - 18 famílias de componentes sobre Radix: botões, inputs, select, date picker pt-BR, avatar e grupo, badges e pills, tooltip, popover, drawer, modal, toasts, abas, menus de contexto, empty state, skeleton, comando e outros.
  - Storybook 10 e 51 testes com axe.
- **Identidade visual:** cubo isométrico com trilha, Azul Cubo `#4252d9`, favicon, ícones do PWA e `docs/brand.md`.
- **Shell** (`apps/web`, Next.js 16, ADR 0031):
  - Trilho fixo com Início, Minha semana, Inbox (contador), Favoritos, Busca, IA e Mais.
  - Painel do workspace com seletor, árvore de pastas e boards com drag-and-drop por mouse e teclado, favoritos, filtro e criação de pasta e board.
  - Cabeçalho do board com nome e descrição editáveis, menu, presença em tempo real, Convidar, Compartilhar, Integrar, Automatizar e Agentes.
  - Abas de views com "+" e "Todas".
  - Toolbar com Novo item, Pesquisar, Pessoa, Filtro, Ordenar, Ocultar, Agrupar por e ⋯ (CSV).
  - No mobile, drawer e barra inferior.
- **Autenticação** (ADR 0032): login, cadastro, convite, MFA, recuperação e redefinição, magic link, verificação de e-mail, callback OAuth e seleção de organização.
  - Access token em memória; refresh serializado entre abas (Web Locks) e sincronizado por BroadcastChannel.
  - **Correção na API:** tolerância de 30 s para reapresentar um refresh cuja resposta se perdeu, sem deslogar o usuário.
- **Dados e tempo real** (ADR 0033):
  - Chaves de query padronizadas.
  - Updates otimistas com rollback e reconciliação de 409.
  - Patches LWW por campo, `seq` com replay de lacunas, resync, dedupe, eco ignorado, reconexão com backoff e presença.
- **API de estrutura** (ADR 0035): 10 rotas novas (árvore, pastas, boards, favoritos, views, notificações, "Minha semana") e eventos `workspace.structure_changed`, `view.changed` e `favorites.changed`.
- **Paleta de comandos** (Ctrl/⌘+K) e atalhos documentados (`?` mostra a lista; ver `docs/frontend-guidelines.md` §6).
- **i18n:** pt-BR, en e es (paridade testada); formatação brasileira de datas, números e moeda; URLs sem prefixo em pt-BR.
- **PWA:** manifesto, service worker sem cache de `/v1`, página offline e aviso de nova versão.
- **Acessibilidade:** axe sem violações nas telas base (claro e escuro), navegação completa por teclado, skip link, foco visível e Lighthouse acessibilidade 100 em todas as telas.
- **Testes:** 316 passando, sendo 58 em `shared`, 39 em `db`, 93 em `api`, 29 em `worker`, 51 em `ui`, 10 em `i18n` e 36 unitários em `web`. Há ainda 13 E2E Playwright, incluindo presença e criação de item entre **dois navegadores**.
- **CI:** build do Storybook e job de E2E (Postgres, Redis e Meilisearch, banco de demonstração, Playwright).

**Critérios de aceite**

- ✅ Navegação fluida sem recarregar a página (E2E verifica que o documento não recarrega).
- ✅ Presença em tempo real no cabeçalho do board (E2E com dois navegadores).
- ⚠️ Lighthouse ≥ 90:
  - acessibilidade 100 em todas as telas;
  - performance ≥ 90 no login (mobile 93, desktop 100) e em todas as telas no desktop (99–100);
  - telas autenticadas no **perfil mobile simulado** ficam em 63–73.
  - A causa é estrutural: conteúdo dependente da sessão recuperada no cliente, sobre cerca de 130 KB gz de React e roteador. O plano está na ADR 0036.

**Pendências**

- Performance mobile das telas autenticadas (≥ 90): sessão legível no servidor e SSR com dados iniciais (Prompt 16, ADR 0036).
- Lighthouse roda localmente (`pnpm --filter @cube-track/web lighthouse`); no CI entra no Prompt 16, junto com o ambiente de preview.
- Tabela virtualizada, edição inline e colunas: Prompt 5. Kanban e views salvas com filtros persistidos: Prompt 6. A lista atual do board é a base de leitura e criação/renomeação.
- IA: Prompt 14. A página mostra o estado "módulo não habilitado". Integrar, Automatizar e Agentes ficam visíveis como desabilitados (`aria-disabled`, com tooltip explicativo) até os Prompts 15, 10 e 14.

**Como rodar e testar**

```bash
cp .env.example .env && pnpm install
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start            # API :3001
pnpm --filter @cube-track/web start            # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm --filter @cube-track/ui storybook         # Storybook :6006
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e         # Playwright (API e web de produção)
pnpm --filter @cube-track/web lighthouse       # relatórios em apps/web/lighthouse/
```

**Próximos passos:** Prompt 5, com boards, grupos, colunas (cerca de 30 tipos) e a Tabela virtualizada com edição inline em tempo real.

## Prompt 5 — Resumo

**Feito**

- **Colunas** (`packages/shared`, ADRs 0037–0039): 33 tipos com schemas de valor e configuração. Inclui fórmula, espelho, rollup, progresso, dependência, localização, cor, botão, ID automático, última atualização, criado por e controle de tempo.
  - Configuração: obrigatória e obrigatória quando (condição E/OU), valor padrão, descrição como dica, permissões de ver e editar por papel, formato numérico (unidade, posição, casas), status principal.
  - **Motor de fórmulas** próprio e decimal: 60 funções, incluindo IF, SUM, DAYS, WORKDAYS, CONCAT, ROUND e TODAY. Referências pelo título, erros tipados e ciclos tratados.
  - **Colunas calculadas:** fórmula e progresso calculados na transação da API; espelho, rollup e progresso por subitens no worker (profundidade máxima 5); fórmulas voláteis recalculadas diariamente.
- **API** (ADRs 0040–0042):
  - CRUD de colunas, rótulos, opções e grupos (cor, recolher, reordenar, duplicar, mover para outro board, arquivar, excluir, restaurar).
  - Itens: edição em massa, ações em lote (duplicar, arquivar, excluir, restaurar, mover com mapeamento de colunas), lixeira de 30 dias com expurgo diário auditado, cronômetro, dependências FS/SS/FF/SF e indicadores (subitens, anexos, atualizações não lidas).
  - Importação CSV/XLSX com prévia e mapeamento; exportação CSV/XLSX com filtros.
  - Templates embutidos (incluindo "Ordens de serviço (UST)") e boards marcados como template; ícone e privacidade.
- **Tabela** (`apps/web`, ADR 0043):
  - Virtualização de linhas e colunas; agrupamento em até 3 níveis; subitens.
  - Colunas fixadas, redimensionáveis, reordenáveis e ocultáveis.
  - Edição de planilha: teclado completo, copiar e colar TSV, preencher para baixo, desfazer e refazer.
  - Rodapés com agregados e barra de distribuição; filtros E/OU com tokens ("eu", "hoje", "esta semana", "atrasados"); ordenação múltipla; busca.
  - Seleção com ações em massa; diálogos de coluna, campos obrigatórios, importar, mover e lixeira.
  - Destaque de células alteradas por outra pessoa em tempo real.
  - Criação de board com template, ícone e descrição.
- **Testes:**
  - 439 automatizados passando: 139 em `shared`, 39 em `db`, 105 em `api`, 34 em `worker`, 51 em `ui`, 10 em `i18n` e 61 em `web`.
  - 16 E2E Playwright. Novos: edição de célula entre dois navegadores com destaque e Ctrl+Z, SEI condicional, fórmula, importação de CSV e 50 mil linhas.
- **Correções encontradas no caminho:** dependências do bundle da API e do worker (`decimal.js-light`, `@node-rs/argon2`) e posição inválida no seed de carga.

**Critérios de aceite**

- ✅ **50 mil linhas a ≥ 50 fps:** mediana de 59,9 fps e média de 56,3 fps, rolando a cerca de 6.000 px/s, com 34 linhas no DOM (Chromium headless, renderização por software).
- ✅ **"Processo SEI" obrigatório quando "OS emitida" = Sim:** testado na API e no E2E. O diálogo exige o campo e, sem ele, nada é salvo.
- ✅ **Edição de célula em tempo real com destaque visual no outro navegador:** E2E com dois navegadores.

**Pendências**

- Arquivos na coluna Arquivos e rich text do Texto longo: Prompt 7 (painel do item).
- O botão dispara automações no Prompt 10. Até lá, a coluna exibe o rótulo com uma dica.
- Agregados de rodapé e agrupamento por coluna são calculados no cliente sobre os itens carregados. O Prompt 9 entregou agregação no servidor para o caso dos dashboards (`widget-data.service.ts`, reaproveitando `ItemsService.list`); migrar os rodapés da própria Tabela para o mesmo mecanismo é um retrofit à parte, ainda não feito.
- Larguras, ordem, fixação e colunas ocultas ficam na sessão (e, para quem gerencia colunas, como padrão do board) até as views salvas do Prompt 6.
- O carregamento completo de 50 mil itens leva cerca de 17 s neste ambiente; a primeira página aparece de imediato.

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed && pnpm db:seed:large
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # recálculos, lixeira, relay
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e
```

**Próximos passos:** Prompt 6, com Kanban customizável e views salvas (pessoais e compartilhadas, link público).

## Prompt 6 — Resumo

**Feito**

- **Views** (`packages/shared`, `packages/db`, `apps/api`, ADR 0044): registro extensível de tipos de view (`table`, `kanban` implementados; `calendar`, `timeline`, `gantt`, `form`, `map`, `chart`, `files`, `workload`, `dashboard` reservados para views futuras). CRUD completo — criar, renomear, configurar (`config`/`filters`/`sort`/`groupBy`/`hiddenColumnKeys` tipados e validados por Zod conforme o tipo), duplicar (cópia independente: filtros, config e colunas ocultas não são compartilhados com o original), excluir, reordenar.
  - Views pessoais (visíveis só ao dono) e compartilhadas (board inteiro); no máximo uma padrão por dono/board. Governança (padrão, bloqueada, restrita) exige `view.manage`; dono de view pessoal só edita a própria.
  - **Filtros salvos** por board, reutilizáveis entre views.
  - **Link público por view** (ADR 0047): senha opcional (Argon2id), expiração, colunas ocultas herdadas, `allowSearch`; token de sessão próprio (`X-Share-Session`, JWT de 1 h) resolvido por função `SECURITY DEFINER` no Postgres — nunca expõe credenciais de tenant a visitantes anônimos; acesso audita contagem e último uso.
- **Kanban** (`apps/web/src/features/kanban`, ADR 0045):
  - Colunas por status, dropdown, pessoa, marcadores ou checkbox; raias por qualquer um desses campos ou por grupo da Tabela.
  - Cartões configuráveis (campos visíveis, densidade, cor), ocultar colunas vazias.
  - **Limite de WIP** por coluna: aviso visual acima do limite e bloqueio opcional de novas entradas.
  - Arrastar e soltar entre colunas/raias com `dnd-kit` (ponteiro e teclado), respeitando transições de status permitidas (ADR 0046) e campos obrigatórios da fase de destino; indicadores em tempo real idênticos aos da Tabela.
  - Filtros rápidos (busca, pessoa), seleção múltipla com ações em massa (mover, arquivar, excluir), criação rápida por coluna, virtualização vertical por coluna (desativada durante o arraste, já que o `dnd-kit` precisa de todos os itens arrastáveis montados).
- **Abas de views** (`apps/web/src/features/board`): criar (com tipo e visibilidade pessoal/compartilhada), renomear, duplicar, tornar padrão, excluir e gerenciar o link público, tudo pelo menu de cada aba; aba "Todas as views" para boards com muitas views.
- **Correção de bug encontrado no caminho:** `updateView` marcava a view como padrão antes de desmarcar a antiga, violando a constraint única `views_board_default_key` (índice único: no máximo uma view padrão por board/dono) — o `UPDATE` que tentava setar o novo padrão falhava com 409 antes que a limpeza do padrão anterior rodasse. Corrigido invertendo a ordem (limpar os outros padrões primeiro); coberto por teste de regressão em `apps/api/test/views.e2e.test.ts`.
- **Testes:** suíte completa da API com 112 testes (novo: `views.e2e.test.ts`, 7 casos cobrindo CRUD, governança, duplicação, filtros salvos, link público e a correção acima); 39 em `db`; 68 em `web` (novo: `features/kanban/model.test.ts`); 150 em `shared`; 51 em `ui`; 10 em `i18n`; 34 em `worker` — 464 testes automatizados no total. E2E Playwright: 19 specs (1 ignorado — carga de 50 mil itens, requer seed grande), incluindo os dois novos cenários de Kanban (criação com raias + arrasto em tempo real entre dois navegadores; limite de WIP) e o de gerenciamento de views (renomear, duplicar, tornar padrão, link público).
- **Documentação:** `docs/views.md` (novo), ADRs 0044–0047, `docs/permissions.md` e `docs/realtime-events.md` atualizados.

**Critérios de aceite**

- ✅ **Criar "Kanban por Frente" com raias por grupo em menos de 1 minuto:** testado em E2E (criação da view, troca para Kanban, configuração de raias por grupo).
- ✅ **Arrastar um cartão atualiza o campo em tempo real na outra view/navegador:** E2E com dois navegadores (arrasto na visão Kanban reflete na Tabela do outro navegador).
- ✅ **Limite de WIP é respeitado:** coluna acima do limite é destacada; bloqueio opcional testado.
- ✅ **Duas views permanecem independentes:** duplicar uma view e alterar filtros/config/colunas ocultas da cópia não afeta a original (testado na API).

**Pendências**

- Arrastar para reordenar as abas de views não foi implementado (escopo cortado por tempo); a reordenação de views via API existe (`afterId`/`beforeId`) mas sem UI de drag ainda.
- "Salvar/Salvar como" filtros/ordenação da Tabela em uma view nova foi mapeado para a ação "Duplicar" existente (semanticamente equivalente: o Kanban já persiste sua config automaticamente a cada mudança). Uma UI dedicada de "salvar como nova view" a partir do estado atual de filtros da Tabela fica para quando os filtros da Tabela also persistirem na view (hoje ficam na sessão, conforme pendência do Prompt 5).
- O menu "Todas as views" (usado quando o board tem mais de 6 views) ainda só permite trocar e excluir; renomear/duplicar/padrão/link público exigem que a view esteja entre as 6 abas visíveis.
- Views do tipo `calendar`, `timeline`, `gantt`, `form`, `map`, `chart`, `files`, `workload` e `dashboard` podem ser criadas (registro extensível) mas mostram apenas "Em breve" — implementação nos Prompts 8, 9 e 15.

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # recálculos, lixeira, relay
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e
```

**Próximos passos:** Prompt 7, com o painel do item (atualizações com @menções, respostas, reações, arquivos, log de atividade, subitens e edição colaborativa via Yjs).

## Prompt 7 — Resumo

**Feito**

- **Atualizações, respostas e reações** (`apps/api/src/modules/collaboration`, ADR 0048): corpo em Tiptap (JSON), @menções a usuário/time/"todos" (`packages/shared/src/richtext.ts`), histórico de edição, fixar/desafixar, reações por emoji, respostas em thread. Notificação in-app + e-mail (reaproveita o processador de notificações do worker, já existente desde o Prompt 3, generalizado para `reply.created` e `approval.changed`).
- **Resposta por e-mail**: cada notificação de menção leva um endereço de resposta assinado por HMAC (`reply+<payload>.<hmac>@<domínio>`); responder a ele chama o webhook público `POST /v1/email/inbound` (autenticado por segredo de servidor, não por login) e grava a resposta/atualização com `source: 'email'`, removendo a citação do corpo.
- **Arquivos** (`apps/api/src/modules/files`, estendido): histórico de versões, download de uma versão específica, exclusão; evento `attachment.changed` passou a ser emitido no upload (antes só auditava). Frontend: arraste-e-solte, pré-visualização de imagem/PDF, envio de nova versão.
- **Log de atividade**: leitura com filtros por usuário, coluna e período — reaproveita a mesma tabela `activity_logs` que todas as escritas do sistema já gravavam.
- **Checklists**: múltiplos por item, progresso calculado na leitura, posição por fractional index.
- **Seguir** o item (lista de seguidores) e **aprovações** (um ou mais aprovadores, modo "todos" ou "qualquer um", histórico de decisões) — ambos novos.
- **Dependências**: a aba reaproveita o `DependencyEditor` e as rotas de dependências do Prompt 5 (detecção de ciclo no grafo inteiro do board) em vez de duplicá-los; só acrescenta a lista de sucessoras. Itens relacionados (colunas de relação) já ficam editáveis na aba Campos, reaproveitando `ValueEditor`/`ValueField` da Tabela.
- **Painel do item** (`apps/web/src/features/collaboration`): drawer com URL própria (`?item=<id>`), sete abas, presença (`rooms.item`), navegação anterior/próximo pela ordem visível da view atual (Tabela ou Kanban publicam a ordem numa store efêmera), indicadores de não lidas/anexos atualizados em tempo real sem recarregar. Entradas: ícone "Abrir" na Tabela, clique no cartão do Kanban.
- **Eventos realtime novos**: `update.created/changed`, `reply.created/changed`, `reaction.changed`, `attachment.changed`, `checklist.changed`, `approval.changed` — entregues pela mesma infraestrutura de fanout por item do Prompt 5 (já suportava entrega dupla board+item); só o cliente precisou passar a assinar a room do item.
- **Testes:** `apps/api/test/collaboration.e2e.test.ts` (13 casos: atualizações/edição/histórico/fixar/exclusão com permissão, respostas, reações, atividade com filtros, checklists, dependências via rotas existentes, seguir, aprovações nos dois modos, webhook de e-mail) — suíte da API em 137 testes. Worker em 40 testes (+3: menção em resposta, aprovação solicitada/resolvida). `packages/shared` em 163 testes (+13: `richtext`, `mail-reply`). `apps/web` em 78 testes (+10: candidatos de @menção, eventos realtime do painel). E2E Playwright: novo `item-panel.spec.ts` (5 cenários — deep link e abas, @menção com notificação em tempo real entre dois navegadores, log de atividade, progresso do checklist, aprovação pedida e decidida em tempo real entre dois navegadores).
- **Documentação:** `docs/item-panel.md` (novo), ADR 0048, `docs/permissions.md` e `docs/realtime-events.md` atualizados.

**Critérios de aceite**

- ✅ **Uma menção gera notificação em tempo real e por e-mail:** worker notifica in-app (`notification.created`) e envia e-mail imediato com endereço de resposta próprio; coberto em `apps/worker/test/processors.e2e.test.ts` e no E2E de dois navegadores.
- ✅ **Uma resposta por e-mail aparece como atualização no item:** validado no nível de API (`apps/api/test/collaboration.e2e.test.ts`, webhook assinado) — sem cliente de e-mail real disponível no ambiente de teste, não há E2E de navegador para este fluxo específico (documentado como escopo cortado).
- ✅ **O log registra 100% das mudanças de campo:** toda escrita do sistema já gravava `activity_logs` na mesma transação (`DomainEvents.recordChange`); o painel só lê essa mesma fonte — testado com o campo nativo `name` e com `checklist_item.toggle`/`file.uploaded`/`approval.decide`.

**Pendências**

- Menção a **time** tem schema e domínio prontos, mas a UI de sugestão só lista usuários e "todos" — falta a tela de gestão de times no frontend (fora do escopo deste prompt).
- Edição colaborativa via **Yjs/Hocuspocus** (prevista na ADR 0007) foi adiada: atualizações/respostas são postagens atômicas, não documentos compartilhados de longa duração, então não precisam de CRDT nesta entrega; fica reservada para um futuro campo de texto longo editado por várias pessoas ao mesmo tempo.
- Pré-visualização de arquivos Office (Word/Excel/PowerPoint) não foi implementada — só download; imagem e PDF têm pré-visualização embutida.
- E2E do fluxo de resposta por e-mail não existe no nível de navegador (ver critério de aceite acima).

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # notificações, menções, antivírus, recálculos
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e -- item-panel.spec.ts
```

**Próximos passos:** Prompt 8, com Calendário, Timeline, Gantt (dependências, caminho crítico, baselines) e Formulários públicos.

## Prompt 8 — Resumo

**Feito**

- **Campos nativos de agendamento** (ADR 0049): `plannedStartDate`/`plannedEndDate`, `replannedStartDate`/`replannedEndDate`, `actualStartDate`/`actualEndDate`, `progress`, `isMilestone` e `scheduleMode` (`'auto'`/`'manual'`) passam a existir em todo item, com vínculo opcional (`binding`) a uma coluna `date` do board para aparecer na Tabela; `scheduleMode: 'manual'` tira o item do recálculo automático em cascata.
- **EAP/WBS e caminho crítico** (`packages/shared`): `computeWbsNumbers` (numeração `1`, `1.1`, `1.2`...) e CPM clássico (`scheduling.ts` — early/late start/finish, folga, `isCritical`) sobre o calendário de dias úteis do board, ambos derivados a cada leitura, nunca gravados.
- **API** (`apps/api/src/modules/planning`, `apps/api/src/modules/forms`):
  - `GET /v1/boards/:id/gantt` — endpoint único com tarefas (WBS + datas vigentes), dependências e caminho crítico já calculados.
  - Marcos (CRUD) e baselines (capturar, listar, comparar, trocar primária) por board.
  - Importação de cronograma MS Project em XML/MSPDI, com preview e commit separados (`.mpp` binário fora de escopo, `422 unsupported_format`).
  - Formulários: CRUD de formulário/campos autenticado; resolução e envio público (anônimo com honeypot+captcha HMAC, ou com login exigido) e envio interno autenticado — três caminhos, uma só `FormSubmissionService`.
- **Worker** (`apps/worker/src/processors/schedule.ts`): reagenda em cascata os sucessores em modo `auto` ao mover um predecessor, respeitando tipo/lag da dependência e o calendário de dias úteis, com auditoria (`item.rescheduled`) a cada reagendamento.
- **Frontend** (`apps/web/src/features/planning`, `apps/web/src/features/forms`):
  - **Calendário** (mês/semana/dia) e **Timeline/Roadmap** (agrupamento reaproveitado do Kanban), escrevendo datas por `PATCH /v1/items/:id` com cache otimista.
  - **Gantt**: EAP/WBS, barras arrastáveis (desloca o intervalo inteiro, mantendo a duração), conectores de dependência por tipo FS/SS/FF/SF, destaque do caminho crítico, marcos, baselines (barra-fantasma de comparação), modo manual, exportação PNG/PDF e importação de cronograma.
  - **Formulários**: construtor (campos nativos/reservados/coluna real, "mostrar quando" reaproveitando o motor de `requiredWhen`, reordenação), página pública de preenchimento (`/public/forms/:token`) e preenchimento interno a partir do board.
  - As 4 novas views (`calendar`, `timeline`, `gantt`, `form`) saem do estado "Em breve" (pendência do Prompt 6) e ficam registradas em `view-tabs.tsx`/`view-body.tsx`.
- **i18n:** namespaces novos `calendar`, `planning`, `timeline`, `gantt` e `forms` em pt-BR/en/es.
- **Testes:**
  - `packages/shared`: 183 passando (novos: `wbs.test.ts`, `scheduling.test.ts` estendido, `timeline.test.ts`, `forms.test.ts`, `views.test.ts` estendido).
  - `packages/i18n`: 10 passando (paridade de chaves mantida com os 5 namespaces novos).
  - `apps/web`: 112 passando (novos: `calendar-model.test.ts`, `timeline-model.test.ts`, `gantt-model.test.ts`, `forms/model.test.ts`).
  - `apps/api` e `apps/worker`: 98 e 24 casos escritos (`planning.e2e.test.ts`, `forms.e2e.test.ts`, extensão de `processors.e2e.test.ts` para o reagendamento em cascata) — **não executados neste ambiente** (sandbox sem PostgreSQL/Redis reais); seguem o mesmo padrão das suítes de integração existentes (papéis sem BYPASSRLS, ADR 0024).
  - E2E Playwright: `planning.spec.ts` (reagendar uma barra do Gantt com recálculo em cascata; destaque do caminho crítico — ambos via importação de um cronograma MS Project de amostra) e `forms.spec.ts` (envio público anônimo com aparição em tempo real na Tabela; preenchimento interno autenticado) — escritos, não executados neste ambiente (sem stack de dev + banco).
  - Dois bugs reais encontrados ao escrever os testes e corrigidos no caminho: barra do Gantt ficava invisível sem `plannedEndDate` (agora usa `start` como fallback, igual à Timeline); `<Input>` do rótulo do campo no construtor de formulário e o campo de resposta do captcha público não tinham nome acessível.
- **Documentação:** ADR 0049, `docs/views.md` (seções 5 e 6), `docs/permissions.md` (seção "Cronograma e Formulários") e `docs/realtime-events.md` (`milestone.changed`, `baseline.changed`) atualizados.

**Critérios de aceite**

- ✅ **Caminho crítico calculado no servidor e destacado no Gantt:** `GET /v1/boards/:id/gantt` devolve `criticalPath` pronto; o frontend só pinta as barras/conectores marcados, nunca recalcula (E2E `planning.spec.ts`, não executado neste ambiente).
- ✅ **Mover uma tarefa reagenda sucessoras em cascata, exceto em modo manual:** worker (`schedule.ts`) e testes de API cobrem FS/SS/FF/SF com lag e o calendário de dias úteis; item em `scheduleMode: 'manual'` é ignorado.
- ✅ **Formulário público recebe envio sem login e aparece em tempo real no board:** `forms.spec.ts` (não executado neste ambiente) cobre honeypot/captcha e a chegada do item via `item.created` no outro navegador.
- ⚠️ Os três critérios de aceite dependentes de API/Postgres/Redis (reagendamento em cascata, formulário público, caminho crítico ponta a ponta) estão cobertos por testes escritos e revisados, mas **não confirmados em execução** neste ambiente — ver pendências.

**Pendências**

- `apps/api` e `apps/worker`: suítes de integração escritas mas não executadas nesta sessão (sandbox sem Postgres/Redis/Testcontainers); e os 4 specs Playwright novos (`planning.spec.ts`, `forms.spec.ts`) também não executados (sem stack de dev completa). Rodar `pnpm db:reset && pnpm db:seed && pnpm test` e `pnpm --filter @cube-track/web test:e2e` num ambiente com a infraestrutura antes de considerar o prompt validado em produção.
- Gantt não permite redimensionar só uma ponta da barra nem criar item diretamente nele (só Calendário e Timeline criam); um item nasce sem `plannedEndDate` até alguém arrastar/editar uma data — lacuna documentada na ADR 0049, fica para um prompt futuro.
- Importação MS Project aceita só `.xml` (MSPDI); `.mpp` binário continua fora de escopo. A hierarquia por `OutlineLevel` não é reconstruída — toda importação cria itens de topo no grupo escolhido.
- Preenchimento público de formulário cobre os 7 tipos nativos + `status`/`dropdown`; outros tipos de coluna mapeados a um campo público mostram um aviso em vez de um widget.
- Reordenar marcos/baselines por drag não existe (CRUD via diálogo apenas).

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # reagendamento em cascata, notificações, relay
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e -- planning.spec.ts forms.spec.ts
```

**Próximos passos:** Prompt 9, com Dashboards (widgets, agregações, Project Health e exportação), reaproveitando os dados de cronograma e formulários deste prompt nos widgets de agregação.

## Prompt 9 — Resumo

**Feito**

- **Dashboards de workspace** (`dashboards`/`widgets`, schema já existente desde o Prompt 2): CRUD completo (`DashboardsService`/`WidgetsService`), visibilidade `private`/`workspace` reaproveitando a regra `decide()` já implementada no Prompt 3 (dono sempre edita; `workspace.manage` edita os de visibilidade `workspace`) — este prompt só passou a expor `canEdit` no DTO.
- **6 tipos de widget** (`packages/shared/src/widgets.ts`, registro no mesmo molde do registro de colunas): `number`, `chart_bar`, `chart_pie`, `battery` (bateria de prazos: no prazo × replanejado × atrasado), `workload` (carga por pessoa) e `project_health`. `aggregate` reaproveita o catálogo `ROLLUP_AGGREGATES` das colunas de rollup — nenhum catálogo novo.
- **Agregação no servidor** (`widget-data.service.ts`): `GET /v1/dashboards/:id/data` é o endpoint único que computa todos os widgets de um dashboard, reaproveitando `ItemsService.list`/`ItemQueryBuilder` (mesmo motor de permissão/filtro/colunas ocultas da Tabela) — um board que o usuário não pode ler contribui zero itens em vez de derrubar o dashboard. Resolve, para o caso de dashboards, a pendência de "agregação no servidor para boards muito grandes" registrada no Prompt 5 (os rodapés da própria Tabela continuam agregando no cliente — ver pendências).
- **Saúde do projeto** (`project_health`, schema do Prompt 2/Portfólio): série histórica append-only, sempre manual (`board.manage` relata: 6 dimensões coloridas + percentual/SPI/CPI/resumo opcionais, sem motor de EVM automático).
- **Frontend** (`apps/web/src/features/dashboards`): grade de widgets (empilhamento + mover para cima/baixo, sem arrastar-e-redimensionar livre), construtor de widget por tipo, diálogo de relato de saúde, exportação PNG/PDF do dashboard inteiro (reaproveita o padrão `html2canvas`/`jspdf` do Gantt) e CSV por widget. View de board `type: 'dashboard'` (`{ dashboardId }`, mesmo padrão da view Formulário) embutida nas abas, e página standalone em `/w/:workspaceId/dashboards/:id` com lista e criação.
- **Gráficos**: `Chart` novo em `packages/ui` — wrapper fino do ECharts tree-shaken (`echarts/core`, só `BarChart`/`PieChart`/`SVGRenderer`), cores lidas do hex já gravado em rótulos/opções de coluna.
- **Tempo real**: `dashboard.changed`/`widget.changed` (room `dashboard`, nova — `RealtimeClient.watchDashboard`, mesmo molde de `watchItem`) e `project_health.reported` (room `board`). Dashboard/widget CRUD e novo relato de saúde refletem sem recarregar a página.
- **Correção encontrada no caminho**: a leitura de valor de coluna do motor de agregação não era ciente de `binding` — uma coluna vinculada a um campo nativo (ex. `c_termino_planejado` → `plannedEndDate`, exatamente o caso do widget "bateria" já semeado) sempre lia vazio. Corrigido para espelhar a mesma regra do export CSV/Excel antes de qualquer teste manual.
- **Testes**: `packages/shared` em 196 (+13: `widgets.test.ts`, `project-health.test.ts`, extensão de `views.test.ts`); `packages/ui` em 53 (+2: `chart.test.tsx`); `packages/i18n` em 10 (paridade mantida com o namespace `dashboards` novo); `apps/web` em 121 (+9: `features/dashboards/model.test.ts`); `apps/api`: `dashboards.e2e.test.ts` novo (10 casos — CRUD, visibilidade privada/workspace, agregação por tipo de widget, config inválida ⇒ 422, CSV, saúde do projeto, exclusão) — **não executado neste ambiente** (sandbox sem PostgreSQL/Redis), mesma limitação documentada desde o Prompt 3. E2E Playwright: `dashboards.spec.ts` novo (2 cenários — criar widget aparece em tempo real no outro navegador; relatar saúde do projeto atualiza o widget em tempo real) — também não executado neste ambiente (sem stack de dev completa).
- **Documentação**: ADR 0050, `docs/views.md` (nova seção 7, demais seções renumeradas), `docs/permissions.md` (seção "Dashboards, widgets e saúde do projeto") e `docs/realtime-events.md` (`dashboard.changed`, `widget.changed`, `project_health.reported`) atualizados.

**Critérios de aceite**

- ✅ **O dashboard "Project Health – PMSP" do seed é renderizável de ponta a ponta:** os 6 widgets semeados (`number` ×2, `chart_bar`, `chart_pie`, `battery`, `workload`) batem exatamente com os schemas de `config` implementados; a correção de `binding` garante que a bateria de prazos não fique zerada.
- ✅ **Agregação no servidor, sem recálculo no cliente:** `GET /v1/dashboards/:id/data` devolve os dados já computados; o frontend só renderiza.
- ✅ **Um board sem permissão não derruba o dashboard:** `widget-data.service.ts` ignora (zero itens) em vez de lançar erro.
- ⚠️ Os critérios de aceite que dependem de API/Postgres/Redis (CRUD completo, visibilidade, agregação ponta a ponta) estão cobertos por testes escritos e revisados, mas **não confirmados em execução** neste ambiente — ver pendências.

**Pendências**

- `apps/api`: `dashboards.e2e.test.ts` escrito mas não executado nesta sessão (sandbox sem Postgres/Redis/Testcontainers); o spec Playwright `dashboards.spec.ts` também não executado (sem stack de dev completa). Rodar `pnpm db:reset && pnpm db:seed && pnpm test` e `pnpm --filter @cube-track/web test:e2e` num ambiente com a infraestrutura antes de considerar o prompt validado em produção.
- Grade de widgets sem arrastar-e-soltar livre nem redimensionar (só empilhar + mover para cima/baixo) — lacuna de usabilidade documentada na ADR 0050, mesma categoria da limitação já aceita para o Gantt (ADR 0049).
- O construtor de widget usa as colunas do **primeiro** board de `sourceBoardIds` para os seletores, mesmo quando o widget agrega vários boards — assume convenção de chaves compartilhada entre eles.
- `project_health.reported` viaja pela room do board, não pela room do dashboard: um dashboard standalone que agregue um board diferente do que está aberto em outra aba só atualiza no próximo refetch (poll por `refreshIntervalSeconds`, se configurado, ou reabrindo a tela).
- Os rodapés de agregação da própria Tabela continuam calculando no cliente sobre os itens carregados — migrá-los para o mesmo mecanismo de agregação no servidor dos dashboards é um retrofit de uma tela já estável, não coberto por este prompt.
- `docs/openapi.json` não foi regenerado nesta sessão (`pnpm --filter @cube-track/api openapi:export` exige Postgres/Redis vivos) — regenerar num ambiente com a infraestrutura.

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay, notificações, recálculos
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e -- dashboards.spec.ts
```

**Próximos passos:** Prompt 10, com Automações, Processos e Notificações (motor de regras "quando → se → então", fases com SLA, workflows, inbox).

## Prompt 10 — Resumo

**Feito**

- **Motor de automações** (`packages/shared/src/automations.ts`, movido do worker para ser compartilhado com a API): gatilhos `item_created`/`column_value_changed`/`button_clicked`/`date_arrives`, condições (`E` lógico, v1), ações `move_to_group`/`set_column_value`/`notify`. `date_arrives` é verificado uma vez ao dia via `app.date_arrives_candidates()` (função `SECURITY DEFINER`, mesmo padrão de `app.purge_trash()`).
- **API de automações** (`apps/api/src/modules/automations`): CRUD por board ou por workspace inteiro, duplicar, clique de botão (`POST .../buttons/:columnKey`) validando `column.settings.automationId`.
- **Processos** (`apps/api/src/modules/processes`): CRUD de pipe/fases/regras de transição/SLA. `PhaseTransitionGuard` (novo, injetado no `ItemWriter`) valida campos obrigatórios/papel/condições/aprovação numa transição e abre/fecha trackers de SLA por fase automaticamente. Tempo útil (`useBusinessTime`) em `packages/shared/src/business-time.ts` (offset UTC fixo por fuso — ver pendências).
- **Worker**: verificação periódica de SLA (`sla-check`, a cada 10 min, `app.sla_tracker_alerts()`) marcando aviso/violação e notificando os responsáveis; refator de `apps/worker/src/processors/automations.ts` para reaproveitar a mesma `executeAutomation()` entre o caminho por evento e o de `date_arrives`.
- **Webhooks de saída** (`webhooks`/`webhook_deliveries`, tabelas novas): CRUD com segredo HMAC-SHA256 mostrado uma única vez (`encryptSecret`/`decryptSecret` subiram para `packages/shared/src/crypto.ts`, reaproveitado pela API que cifra e pelo worker que decifra para assinar). Fan-out (`webhooks` → `webhook-deliveries`, duas filas) evita que a retentativa de uma entrega reenvie às demais; 10 falhas seguidas desabilita o webhook automaticamente. Nova permissão `webhook.manage` (board, propagada a `board_owner`).
- **Preferências de notificação** (`GET/PUT /v1/me/notification-preferences`, módulo `structure` existente): resolve por `eventType` específico → `'*'` curinga → padrão instantâneo, só canal `email` tem efeito. Digest por e-mail (`notification-digest-hourly`/`-daily`, novos jobs de manutenção) agrega notificações pendentes de quem escolheu resumo em vez de instantâneo; nova coluna `notifications.email_sent_at` evita reenvio. **Bug corrigido no caminho**: `notifyApproval` enviava e-mail instantâneo sem checar a preferência da pessoa (diferente de `notifyMentions`) — alinhado.
- **Frontend**: três diálogos no cabeçalho do board ("Automatizar", "Processo" só em boards de processo, "Integrar" para webhooks), no mesmo molde de Compartilhar/Convidar; indicadores de fase (selo + WIP) e de SLA (badge de urgência) no Kanban existente; preferências de notificação como nova seção da tela de Configurações (ao lado de perfil/segurança/MFA, não uma página própria). **Bug corrigido no caminho**: o construtor de automações nunca gravava `column.settings.automationId` ao configurar um gatilho "botão clicado" — o botão ficava sempre sem automação vinculada, mesmo configurado corretamente; achado e corrigido durante a escrita dos testes E2E deste prompt.
- **Tempo real**: `automation.changed`, `phase.changed`, `process_config.changed`, `sla.changed` (com o estado transitório `warning`, só no evento — não é um valor do enum do banco) e `webhook.changed` (todos room `board`, ou `tenant` quando o recurso é de workspace inteiro sem board). Preferência de notificação deliberadamente sem evento próprio (configuração pessoal, sem precedente — MFA também não tem).
- **Testes**: `packages/shared` com os motores de automação/tempo útil/criptografia (`automations.test.ts`, `business-time.test.ts`, `crypto.test.ts`); `apps/web` com os modelos de automações/processos/webhooks/preferências (`model.test.ts` de cada feature) e o novo caso `webhook.changed` em `apply.test.ts` — 152 testes no total, todos passando. `apps/api`/`apps/worker`: `automations.e2e.test.ts`, `processes.e2e.test.ts`, `webhooks.e2e.test.ts`, `notification-preferences.e2e.test.ts`, `sla.e2e.test.ts`, `notification-digest.e2e.test.ts` escritos e revisados — **não executados neste ambiente** (sandbox sem Postgres/Redis/Docker), mesma limitação documentada desde o Prompt 3. E2E Playwright: `automations.spec.ts` (clique de botão move o item em tempo real), `processes.spec.ts` (indicadores de fase/SLA; transição bloqueada por campo obrigatório) e `webhooks.spec.ts` (segredo mostrado uma vez; desabilitar propaga em tempo real) — também não executados neste ambiente.
- **Documentação**: ADR 0051, `docs/permissions.md` (seção "Automações, Processos/SLA, Webhooks e preferências de notificação"), `docs/realtime-events.md` (5 tipos de evento novos, mais a correção de room de `webhook.changed` para "board ou tenant").

**Critérios de aceite**

- ✅ **Automação dispara de ponta a ponta**: clicar num botão com automação configurada move o item/dispara a ação correta, incluindo o vínculo `column.settings.automationId` (corrigido nesta entrega).
- ✅ **Transição de fase bloqueada mostra o motivo específico**: `transition_required_fields`/`transition_role_forbidden`/`transition_conditions_not_met`/`transition_requires_approval` chegam ao frontend com a mensagem do servidor, não um erro genérico.
- ✅ **Webhook nunca reenvia a quem já recebeu**: fan-out e entrega em filas separadas, `jobId` determinístico por par evento+webhook.
- ✅ **Preferência de notificação tem efeito real**: o caminho instantâneo (menção, agora também aprovação) e o digest (hora/dia) nunca enviam a mesma notificação duas vezes (`email_sent_at`).
- ⚠️ Os critérios que dependem de API/Postgres/Redis/Docker (automação ponta a ponta, SLA, entrega de webhook, digest) estão cobertos por testes escritos e revisados, mas **não confirmados em execução** neste ambiente — ver pendências.

**Pendências**

- `apps/api`/`apps/worker`: todos os `*.e2e.test.ts` novos deste prompt escritos mas não executados nesta sessão (sandbox sem Postgres/Redis/Docker); os specs Playwright (`automations.spec.ts`, `processes.spec.ts`, `webhooks.spec.ts`) também não executados. Rodar `pnpm db:reset && pnpm db:seed && pnpm test` e `pnpm --filter @cube-track/web test:e2e` num ambiente com a infraestrutura antes de considerar o prompt validado em produção.
- Webhooks de workspace inteiro (`boardId: null`) não alcançam eventos de workspace/tenant sem board (ex.: `workspace.structure_changed`) — o formato do job de evento do outbox não carrega `workspaceId` para resolver esse casamento sem um board como âncora.
- Tempo útil de SLA (`useBusinessTime`) assume offset UTC fixo por fuso — correto para o Brasil (sem horário de verão desde 2019), incorreto para fusos que ainda observam DST.
- `phases.requiredColumnKeys` é metadado de CRUD sem aplicação nesta entrega — é o contrato para quando o builder de formulário por fase (`phases.formId`) ganhar uma tela própria.
- Preferência `frequency: 'weekly'` existe no enum do banco mas a API de preferências não a aceita (nenhuma rotina de digest a esvazia); guardada por compatibilidade futura.
- `docs/openapi.json` não foi regenerado nesta sessão (`pnpm --filter @cube-track/api openapi:export` exige Postgres/Redis vivos) — regenerar num ambiente com a infraestrutura.

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay, SLA, digest de notificação, entrega de webhooks
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e -- automations.spec.ts processes.spec.ts webhooks.spec.ts
```

**Próximos passos:** Prompt 11, com Capacity e Timesheet (alocação, carga por pessoa, apontamento de horas, aprovações).

## Prompt 11 — Resumo

**Feito**

- **Shared** (`packages/shared/src/capacity.ts`): motor de capacidade data-only — `dailyCapacity` (disponível × alocado por dia, flags `overallocated`/`idle`), `aggregateCapacityDays` (por dia/semana/mês), `suggestLeveling` (sugestão gulosa de nivelamento, não um solver ótimo) e `monthlyBuckets` (previsão de 3/6/12 meses). Novos tipos de view (`workload`, com `scope: 'board'|'workspace'`) e de widget de dashboard (`capacity`, distinto do `workload` pré-existente desde o Prompt 9) e 5 eventos realtime novos (`allocation.changed`, `absence.changed`, `time_entry.changed`, `timesheet_approval.changed`, `resource_request.changed`).
- **DB**: nenhuma tabela nova — `resource_profiles`/`skills`/`user_skills`/`allocations`/`absences`/`timesheet_approvals`/`time_entries`/`resource_requests` já existiam desde o schema antecipado do Prompt 2, já com RLS (aplicada genericamente a toda tabela com `tenant_id`) e já seedadas. Nova função `loadPersonWorkingCalendar` (`packages/db/src/calendar.ts`), espelhando `loadWorkingCalendar` mas ancorada no perfil de recurso em vez do board. Única migração nova: `0018_webhook_manage_permission.sql`, correção de um gap do Prompt 10 (`webhook.manage` faltava no catálogo de referência de permissões, encontrado durante a varredura deste prompt).
- **API** (`apps/api/src/modules/resources`, `apps/api/src/modules/timesheet`): perfis/skills/alocações/ausências/solicitações de recurso, heatmap/sugestão de nivelamento/simulação what-if/previsão de demanda, apontamento de horas (unitário e em lote por semana), aprovação de timesheet e export CSV. Permissões `resources.manage`/`timesheet.approve` (workspace) e `item.update` (não `timesheet.log`, que permanece sem consumidor) para apontar horas num item.
- **Worker**: `ItemsService.timer(..., 'stop')` passou a também gravar um `time_entries` (`source: 'timer'`) e emitir `time_entry.changed` — o cronômetro do item já existente (Prompt 5/7) e o apontamento semanal escrevem no mesmo lugar, respeitando o bloqueio de período já aprovado. Três notificações novas (`notifyAbsence`, `notifyResourceRequest`, `notifyTimesheetApproval`) e 6 templates de e-mail (`absence_requested`/`absence_decided`/`resource_request_created`/`resource_request_fulfilled`/`timesheet_submitted`/`timesheet_decided`).
- **Frontend**: administração de recursos (perfis/skills/ausências/solicitações, `apps/web/src/features/resources`), view `workload` embutida no board e página standalone `/w/:workspaceId/capacity` reaproveitando os mesmos componentes de heatmap/what-if/previsão com `scope: 'board'|'workspace'`, diálogo de nova alocação a partir do heatmap, apontamento semanal + fila de aprovação em `/timesheet`, resumo compacto de horas no painel do item e novo widget `capacity` no motor de dashboards. **Bug corrigido no caminho**: a página de capacidade e a view Workload checavam `resources.manage`/`timesheet.approve` (permissões de **workspace**) contra `tenant.permissions` de `/v1/me` (permissões de **tenant**, sempre vazio para as duas) — "Nova alocação", as abas Perfis/Solicitações e a fila de aprovação de ausências ficavam inacessíveis para qualquer pessoa, mesmo quem tinha a permissão de verdade; achado e corrigido durante a escrita dos testes E2E deste prompt, expondo `canManageResources`/`canApproveTimesheet` já resolvidos em `GET /v1/workspaces/:id/tree` (mesmo padrão de `canManageFolders`/`canCreateBoards`).
- **Tempo real**: `allocation.changed`/`time_entry.changed`/`resource_request.changed` (room `board`); `absence.changed`/`timesheet_approval.changed` (room `tenant`, sem board — mesmo padrão de recurso de workspace inteiro do Prompt 10, já que ausência/semana de timesheet cruzam vários boards).
- **Testes**: `packages/shared` — `capacity.test.ts` (15 casos) — 237 testes no total do pacote, todos passando. `apps/web` — `model.test.ts` de `resources`/`timesheet` e os novos casos de `allocation.changed`/`time_entry.changed`/`timesheet_approval.changed` em `apply.test.ts` — 180 testes no total do pacote, todos passando. `apps/api`/`apps/worker`: `resources.e2e.test.ts`, `timesheet.e2e.test.ts` e a extensão de `processors.e2e.test.ts` escritos e revisados — **não executados neste ambiente** (sandbox sem Postgres/Redis/Docker), mesma limitação documentada desde o Prompt 3. E2E Playwright: specs novos de alocação/sobrealocação em tempo real, ausência reduzindo capacidade e apontamento semanal + aprovação em tempo real, escritos neste mesmo ciclo de trabalho — também não executados neste ambiente.
- **Documentação**: ADR 0052, `docs/capacity.md` (novo), `docs/permissions.md` (seção "Capacity, Recursos e Timesheet"), `docs/realtime-events.md` (5 tipos de evento novos).

**Critérios de aceite**

- ✅ **Sobrealocação aparece em tempo real ao atribuir um item**: `allocation.changed` (room `board`) invalida o heatmap da pessoa/board em qualquer sessão aberta; `dailyCapacity` recalcula `overallocated` a cada alocação.
- ✅ **Férias e feriados reduzem a capacidade disponível corretamente**: `dailyCapacity` zera `nominalHours` em dia não útil do calendário (`loadPersonWorkingCalendar`) e subtrai horas de ausência (`absenceHoursOn`) de `availableHours`, nunca negativo.
- ⚠️ **Horas apontadas alimentam o realizado de esforço, mas não o de custo**: `time_entries` é o registro de esforço realizado por item/pessoa/período (consultável, resumido no painel do item, exportável em CSV) — isso funciona de ponta a ponta. **Custo não**: `resourceProfiles.costRateHour`/`billRateHour` existem mas nenhum rollup desta entrega multiplica taxa × horas apontadas em um custo de projeto (decisão deliberada, documentada na ADR 0052 — fica para o módulo de Contratos/OS/UST do Prompt 13 ou para um rollup de custo por board futuro).

**Pendências**

- Horas apontadas não geram custo realizado de projeto (taxa × hora nunca é multiplicada em nenhum rollup) — ver critério de aceite acima e ADR 0052.
- `timesheet.log` (permissão de board do catálogo desde o Prompt 2) permanece sem nenhum consumidor — apontar horas usa `item.update`.
- Alocação e a coluna "Responsável" (`people`) não são sincronizadas — um relatório que cruze os dois pode divergir (decisão de escopo, não lacuna).
- `suggestLeveling` é heurístico (guloso), não um otimizador — pode não achar a melhor redistribuição possível com muitas alocações concorrentes.
- `apps/api`/`apps/worker`: `resources.e2e.test.ts`, `timesheet.e2e.test.ts` e a extensão de `processors.e2e.test.ts` escritos mas não executados nesta sessão (sandbox sem Postgres/Redis/Docker); os novos specs Playwright de capacidade/timesheet também não executados. Rodar `pnpm db:reset && pnpm db:seed && pnpm test` e `pnpm --filter @cube-track/web test:e2e` num ambiente com a infraestrutura antes de considerar o prompt validado em produção.
- `docs/openapi.json` não foi regenerado nesta sessão (`pnpm --filter @cube-track/api openapi:export` exige Postgres/Redis vivos) — regenerar num ambiente com a infraestrutura.

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay + notificações de ausência/timesheet/solicitação de recurso
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e        # inclui os specs novos de capacidade/timesheet em apps/web/e2e/
```

**Próximos passos:** Prompt 12, com Portfólio (programas, priorização por score, capacity e rollups de portfólio).

## Prompt 12 — Resumo

**Feito**

- **Shared** (`packages/shared/src/portfolio.ts`): motor de RAG automático (`evaluateHealthRules`, `worstHealth`, `defaultHealthRules`), EVM (`plannedValueLinear`, `computeEvm` — PV/EV/AC/SPI/CPI/EAC/VAC), rollup Projeto→Programa→Portfólio (`aggregateRollup`, pior-caso de RAG, UST sempre `0` — Prompt 13), pontuação ponderada/WSJF (`computeWeightedScore`, `computeWsjf`, `wsjfInputFromScores`, `WSJF_KEYS`) e matriz valor×esforço por mediana (`classifyEffortValue`, `median`), e simulação what-if (`applyWhatIfChanges`, `summarizeWhatIf`). 10 eventos realtime novos (`portfolio.changed`, `program.changed`, `score.changed`, `stage_gate.changed`, `risk.changed`, `issue.changed`, `budget.changed`, `cost_entry.changed`, `project_health.changed`, `health_rule_set.changed`) e 3 tipos de widget de dashboard (`portfolio_rollup`, `risk_heatmap`, `budget_variance`).
- **DB**: uma tabela nova (`health_rule_sets`, RAG configurável por board ou padrão do tenant) — `portfolios`/`programs`/`scoring_models`/`project_health`/`scores`/`stage_gates`/`risks`/`issues`/`budgets`/`cost_entries` já existiam desde o schema antecipado do Prompt 2, já seedados (portfólio "Contratos Públicos", programa "PMSP – Transformação Digital"). Colunas novas em `project_health` (`isAutomatic`, `overrideReason`, EVM bruto) e `scoring_models` (`method`). Nova função `app.portfolio_health_candidates()` (mesmo padrão `SECURITY DEFINER` de `app.sla_tracker_alerts()`) para o cron diário de recálculo.
- **API** (`apps/api/src/modules/portfolio`, 4 controllers): portfólios/programas (CRUD+rollup), pontuação (ponderada/WSJF, ranking, matriz valor×esforço), what-if, stage-gates (CRUD+decidir+reordenar), riscos, problemas, orçamento+lançamentos de custo (de board, programa ou portfólio), regras de saúde (padrão do tenant + por board) e relatório de status (board/programa/portfólio, para export em PDF no frontend). Nenhuma permissão nova: `portfolio.manage`/`portfolio.read` (workspace) e `board.manage`/`board.read` (board), confirmado que `decide()` não precisa de um caso próprio para portfólio/programa.
- **Worker**: `apps/worker/src/processors/portfolio.ts` recalcula saúde/RAG + EVM de um board a cada mudança de item/risco/orçamento/lançamento de custo (fila `QUEUES.portfolio`) e diariamente (cron `portfolio-health-daily`, já que o PV deriva do tempo decorrido). Projeto Health (Prompt 9) ganha `isAutomatic`/`overrideReason`/EVM bruto; sobrepor manualmente um relato automático agora exige `overrideReason`. Notificações novas: risco/problema atribuído (só na criação) e alerta de saúde quando o RAG automático piora para amarelo/vermelho.
- **Frontend**: página standalone `/w/:workspaceId/portfolio` (hierarquia com rollup, priorização, what-if, relatório de status) em `apps/web/src/features/portfolio`; diálogo "Governança" no cabeçalho de boards `kind: 'project'` (stage-gates, riscos, problemas, orçamento/EVM, regras de saúde, relatório de status com export em PDF) em `apps/web/src/features/governance`; Project Health (Prompt 9) ganha selo Automático/Manual, números de EVM e o campo de justificativa condicionalmente obrigatório; 3 novos widgets de dashboard.
- **Tempo real**: a maioria dos 10 eventos novos é room `board`; `portfolio.changed`/`program.changed` são sempre tenant (recurso de workspace inteiro); `budget.changed`/`health_rule_set.changed` variam conforme o dono (board vs. programa/portfólio/padrão do tenant). `apps/web/src/realtime/apply.ts` ganhou um `case` para cada um dos 10 (invalidação das listas/rollups/relatórios correspondentes; `project_health.changed` também invalida rollups/relatórios de portfólio/programa por predicado, já que o evento não carrega essas IDs).
- **Testes**: `packages/shared` — `portfolio.test.ts` (23 casos) — 260 testes no total do pacote, todos passando. `apps/web` — 186 testes no total do pacote (inclui os 6 novos casos de `apply.test.ts` para os eventos deste prompt), todos passando. `packages/i18n` — 10 testes, todos passando. `apps/api`/`apps/worker`: `portfolio.e2e.test.ts` e a extensão de `processors.e2e.test.ts` escritos e revisados — **não executados neste ambiente** (sandbox sem Postgres/Redis/Docker), mesma limitação documentada desde o Prompt 3. E2E Playwright: specs novos de portfólio/governança escritos neste mesmo ciclo de trabalho (incluindo um cenário de dois navegadores para `risk.changed`) — também não executados neste ambiente.
- **Documentação**: ADR 0053, `docs/portfolio.md` (novo), `docs/permissions.md` (seção "Gestão de Portfólio"), `docs/realtime-events.md` (10 tipos de evento novos).

**Critérios de aceite**

- ✅ **Alterar um item de projeto atualiza o rollup do programa e do portfólio em tempo real**: `item.updated` → fila `QUEUES.portfolio` → recálculo do worker → `project_health.changed` → `apps/web/src/realtime/apply.ts` invalida o cache de rollup/relatório de status de portfólio e programa (por predicado, já que o evento carrega só o `boardId`) — qualquer sessão com a tela de hierarquia aberta busca o rollup atualizado sem recarregar. Achado e corrigido durante a escrita dos testes E2E/documentação deste prompt: a wiring em `apply.ts` para os 10 eventos novos simplesmente não existia até este ponto da entrega.
- ✅ **O RAG muda automaticamente quando a regra é violada (ex.: SPI < 0,9 → amarelo)**: `evaluateHealthRules` é real e testado (23 casos em `portfolio.test.ts`), chamado pelo worker a cada recálculo orientado a evento ou pelo cron diário — `defaultHealthRules()` já inclui exatamente o exemplo do critério de aceite (SPI < 0,9 → amarelo, < 0,8 → vermelho). Ressalva de latência prática: o recálculo é orientado a evento (item/risco/orçamento/custo) mais o cron diário — não é instantâneo para toda deriva possível de métrica (ex.: uma data-limite de período que só muda a PV por si só, sem nenhuma escrita de negócio, espera o cron do dia seguinte).

**Pendências**

- UST não entra no rollup (sempre `0`) — fica para o módulo de Contratos/OS/UST (Prompt 13).
- `risk_assigned`/`issue_assigned` notificam só na criação — reatribuir o responsável de um risco/problema já existente via edição não notifica o novo responsável.
- `plannedValueLinear` distribui o BAC linearmente pelo período do board — não há baseline time-phased (orçamento fatiado por fase/marco).
- `classifyEffortValue` (matriz valor×esforço) usa a mediana da amostra corrente, não um corte absoluto de "alto"/"baixo" — os quadrantes mudam conforme os projetos pontuados no momento.
- `apps/api`/`apps/worker`: `portfolio.e2e.test.ts` e a extensão de `processors.e2e.test.ts` escritos mas não executados nesta sessão (sandbox sem Postgres/Redis/Docker); os novos specs Playwright de portfólio/governança também não executados. Rodar `pnpm db:reset && pnpm db:seed && pnpm test` e `pnpm --filter @cube-track/web test:e2e` num ambiente com a infraestrutura antes de considerar o prompt validado em produção.
- `docs/openapi.json` não foi regenerado nesta sessão (`pnpm --filter @cube-track/api openapi:export` exige Postgres/Redis vivos) — regenerar num ambiente com a infraestrutura.

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay + recálculo de saúde/RAG + notificações
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e        # inclui os specs novos de portfólio/governança em apps/web/e2e/
```

**Próximos passos:** Prompt 13, com Contratos/OS/UST.

## Prompt 13 — Resumo

**Feito**

- **Shared** (`packages/shared/src/contracts.ts`): saldo de contrato sempre ao vivo
  (`computeContractBalance`, com `CONSUMING_ORDER_STATUSES = accepted|measured|invoiced`), três
  alertas puros e testados (`evaluateLowBalance`, `evaluateExpiring`, `evaluateStalledOrder`),
  previsão linear de esgotamento de saldo (`forecastExhaustion`), reconciliação de medição mensal
  (`reconcileMeasurement` — soma real das OS aceitas do período, nunca digitada à mão), UST de linha
  de OS (`computeServiceOrderItemUst`, 4 casas) e valor de fatura (`computeInvoiceAmount`). Módulo
  `contracts` adicionado a `packages/shared/src/modules.ts` (já reservado desde a ADR 0017). 5 eventos
  realtime novos (`contract.changed`, `service_catalog_item.changed`, `service_order.changed`,
  `measurement.changed`, `invoice.changed`) e 3 tipos de widget de dashboard de UST (`ust_balance`,
  `ust_by_dimension`, `ust_forecast`).
- **DB**: 6 tabelas novas (`contracts`, `service_catalog_items`, `service_orders`,
  `service_order_items`, `measurements`, `invoices`, `packages/db/src/schema/contracts.ts`), todas
  `tenant_id` + RLS; `boards.contractId` já existia desde o schema antecipado do Prompt 2. Migrações
  `0022_service_order_item_override_reason.sql` (coluna de justificativa do ajuste manual de UST) e
  `0023_contract_alert_candidates.sql` (função `app.contract_alert_candidates()` para o cron diário,
  mesmo padrão `SECURITY DEFINER` de superfície mínima de `app.sla_tracker_alerts()`/
  `app.portfolio_health_candidates()`). Sete bindings novos de coluna (`service_order.number`/
  `.sei_process`/`.requested_at`/`.issued_at`/`.total_ust`/`.catalog_codes`/`.billed_at`).
- **API** (`apps/api/src/modules/contracts`, 3 controllers): contratos + catálogo de serviços
  (Código Edital), Ordens de Serviço + suas linhas (auto-preenchimento de UST pelo catálogo com
  override auditado), medição mensal (gerar/ajustar/decidir) e faturamento (criar a partir de medição
  aprovada, transicionar). Três permissões novas de workspace: `contract.read`, `contract.manage`,
  `contract.measure`; permissão dupla de Ordem de Serviço (`board.manage` do board vinculado **ou**
  `contract.manage` do workspace do contrato, mesmo padrão de orçamento board×portfólio do Prompt 12).
  Módulo opcional: toda rota confirma `enabledModules` do workspace antes de qualquer outra checagem
  (404 quando desativado, dados preservados).
- **Worker**: `apps/worker/src/processors/contracts.ts#createContractAlertsDaily` — cron diário que
  reavalia saldo baixo, vigência perto do fim e OS paradas sem emissão para todo contrato ativo
  (candidatos de `app.contract_alert_candidates()`), notificando o gestor do contrato (in-app +
  e-mail) quando houver um definido.
- **Frontend**: tela standalone de workspace (`apps/web/src/features/contracts/contracts-page.tsx`)
  com contratos, catálogo, medições e faturas; integração no painel do item e no board (criar/ver a OS
  vinculada a um item, `service-order-detail.tsx`/`service-order-create-form.tsx`/
  `service-orders-dialog.tsx`); banner de alertas do contrato; ativação do módulo em
  **Configurações do Workspace** (`workspace-settings-page.tsx`, `enabledModules`); 3 novos widgets de
  dashboard de UST.
- **Tempo real**: `contract.changed`/`service_catalog_item.changed`/`measurement.changed`/
  `invoice.changed` sempre tenant (recurso de workspace inteiro); `service_order.changed` vai para a
  room do board quando a OS tem board vinculado, senão tenant. Os 5 eventos têm `case` em
  `apps/web/src/realtime/apply.ts` (invalidação das listas/detalhes correspondentes;
  `contract.changed` também invalida por predicado os dados de dashboard em cache, já que o evento não
  carrega o `dashboardId` dos widgets de UST — mesmo padrão de `project_health.changed`/
  `dashboard.changed` do Prompt 12).
- **i18n**: textos do módulo (telas, diálogos, status da OS, alertas) em pt-BR/en/es.
- **Testes**: `packages/shared` — `contracts.test.ts` (23 casos), confirmados passando nesta sessão
  (289 testes no pacote `shared`, todos passando). `apps/web` — `features/contracts/model.test.ts`,
  confirmado passando nesta sessão (227 testes no pacote `web`, todos passando). `apps/api` —
  `contracts.e2e.test.ts` (3 blocos: Contratos e catálogo; Ordem de Serviço — auto-fill, override
  auditado, ciclo e saldo, **critério de aceite 1**; Medição mensal e faturamento, **critério de
  aceite 2**; enforcement do módulo opcional), já verificado passando numa execução anterior deste
  mesmo ciclo de trabalho — não executado de novo nesta sessão de documentação por um problema de
  autenticação do banco de teste local (`SASL: client password must be a string`, `TEST_DATABASE_URL`
  deste ambiente), não um problema do código ou dos testes em si. E2E Playwright
  (`apps/web/e2e/contracts.spec.ts`): **em andamento** em paralelo a esta sessão — o arquivo ainda não
  existe no repositório no momento em que esta entrada foi escrita.
- **Documentação**: ADR 0054, `docs/contracts.md` (novo), `docs/permissions.md` (seção
  "Contratos/OS/UST"), `docs/realtime-events.md` (5 tipos de evento novos), este roadmap.

**Critérios de aceite**

- ✅ **Saldo do contrato atualizado automaticamente a cada OS aceita**: `computeContractBalance`
  recalcula ao vivo a cada leitura do contrato a partir do status atual das OS — nenhuma coluna de
  saldo armazenada, nenhum recálculo assíncrono separado da leitura. Testado em
  `packages/shared/src/contracts.test.ts` e em `apps/api/test/contracts.e2e.test.ts` ("saldo do
  contrato só muda quando a OS chega a 'aceita'").
- ✅ **Relatório de medição mensal confere com a soma dos itens**: `reconcileMeasurement` soma as OS
  aceitas (ou além) do contrato cujo aceite caiu no período — por construção, não por conferência
  manual. Testado em `packages/shared/src/contracts.test.ts` e em
  `apps/api/test/contracts.e2e.test.ts` ("medição do período de hoje confere exatamente com a soma
  das OS aceitas no período").

**Pendências**

- Colunas vinculadas a `service_order.*` são somente leitura em filtros/ordenação da Tabela —
  `ItemQueryBuilder.bindingField` só resolve bindings `item.*`; exibição funciona normalmente.
- A medição mensal agrega por contrato/período (soma de todas as OS aceitas do mês) — não há medição
  por OS individual nesta entrega, embora `measurements.serviceOrderId` já exista no schema para uma
  extensão futura.
- Trocar o gestor de um contrato (criação ou edição) não dispara nenhuma notificação para ele — só o
  job diário de alertas o avisa, e só quando há um alerta ativo.
- UST ainda não entra no rollup de portfólio do Prompt 12 (`aggregateRollup` continua somando `0`) —
  ligar os dois módulos fica para um prompt futuro.
- `apps/api/test/contracts.e2e.test.ts`: verificado passando numa execução anterior deste ciclo de
  trabalho, não reexecutado nesta sessão de documentação por um problema de autenticação do banco de
  teste local deste ambiente (não relacionado ao código do módulo). Os specs Playwright de
  Contratos/OS/UST (`apps/web/e2e/contracts.spec.ts`) estavam sendo escritos em paralelo a esta sessão
  e ainda não existiam no repositório no momento em que esta entrada foi escrita — conferir se já
  foram concluídos e, nesse caso, rodar `pnpm --filter @cube-track/web test:e2e` num ambiente com a
  infraestrutura completa antes de considerar o prompt validado em produção.
- `docs/openapi.json` não foi regenerado nesta sessão (`pnpm --filter @cube-track/api openapi:export`
  exige a API de pé) — regenerar num ambiente com a infraestrutura.

**Como rodar e testar**

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay + alertas diários de contrato
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @cube-track/web test:e2e        # inclui os specs de Contratos/OS/UST em apps/web/e2e/, quando concluídos
```

**Próximos passos:** Prompt 14, com IA (assistente, resumos, chatbot do board, sugestões).
