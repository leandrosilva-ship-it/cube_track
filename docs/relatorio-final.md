# CUBE TRACK — Relatório final (Prompts 1–16)

> Resumo executivo do desenvolvimento completo. Detalhe prompt a prompt (feito, pendências, como
> rodar e testar) em [`docs/roadmap.md`](roadmap.md); decisões técnicas em [`docs/adr/`](adr/README.md).

## 1. Entregue

Os 16 prompts do protocolo de `CLAUDE.md` §7 estão concluídos:

| Bloco | Prompts | Entregue |
| --- | --- | --- |
| Fundação | 1–4 | Arquitetura, monorepo, banco (88 tabelas + RLS por tenant + auditoria particionada), backend base (auth, RBAC 5 níveis, REST/GraphQL, realtime, busca, arquivos), frontend base (shell, i18n pt-BR/en/es, PWA) |
| Operacional | 5–8 | Boards com 33 tipos de coluna e fórmulas, Tabela virtualizada (50 mil itens), Kanban, views salvas, painel do item completo (updates/arquivos/checklist/dependências/aprovações), Calendário/Timeline/Gantt (CPM, baselines, import MS Project) e Formulários |
| Gestão | 9–12 | Dashboards (6 tipos de widget, saúde do projeto), automações + processos com fases/SLA + webhooks, capacidade/timesheet (heatmap, nivelamento, apontamento), portfólio (RAG automático, EVM, scoring/WSJF, rollup, stage-gates, riscos) |
| Setorial e plataforma | 13–15 | Contratos/OS/UST (módulo opcional, saldo de UST ao vivo, faturamento), IA (assistente, resumos, previsões, agentes com aprovação humana), API pública + SDK + integrações (Google/Microsoft/Slack/Teams/GitHub/GitLab/Azure DevOps) + importadores + templates |
| Enterprise | 16 | SSO SAML 2.0 + SCIM 2.0, políticas de senha/sessão/IP, auditoria avançada + LGPD, billing (Stripe real + Pix/boleto stub), testes de carga k6, cobertura de domínio medida, deploy (Docker/Helm/CI-CD), observabilidade (Grafana/alertas/runbooks) |

Toda funcionalidade crítica funciona em tempo real entre dois navegadores (Socket.IO + Redis
adapter), respeita permissões por tenant/workspace/board/coluna/item, e está documentada (ADRs
0001–0060, `docs/*.md`). Catálogo completo de ADRs: [`docs/adr/README.md`](adr/README.md).

## 2. Cobertura de testes (números reais, medidos nesta sessão)

Pela primeira vez no projeto, a suíte inteira rodou contra infraestrutura real (PostgreSQL 16 +
Redis nativos, RLS sem `BYPASSRLS`) em vez de só ser escrita. Detalhe completo, comandos exatos e a
lista de falhas pré-existentes em `docs/roadmap.md` (seção "Testes" do Prompt 16) e ADR 0060.

| Pacote/suíte | Resultado |
| --- | --- |
| `packages/shared` (domínio) | 450/450 testes ✅ — cobertura 96,27% linhas/stmts, 81,34% branches, 97,76% funções |
| `apps/api` (`domain/`) | 112/112 testes ✅ — cobertura 98,1% linhas/stmts, 90,06% branches, 100% funções |
| `apps/api` (suíte completa) | 352 passaram, 13–14 falharam (pré-existentes), 3 puladas |
| `apps/worker` | 72 passaram, 7 falharam (1 Meilisearch indisponível no sandbox, 6 pré-existentes) |
| `packages/db` | 41/41 ✅ |
| `packages/ui` / `i18n` / `sdk` | 53/53, 10/10, 11/11 ✅ |
| `apps/web` (unitário) | 268/268 ✅ |
| `apps/web` E2E Playwright (2 execuções completas) | 1ª: 21/50 passaram · 2ª: 30/50 passaram — as mesmas 19 falhas reproduzidas de forma idêntica nas duas execuções (bugs reais pré-existentes, não desta frente) |
| Acessibilidade (axe, WCAG 2.1 A/AA) | 0 violações em todas as telas varridas (login, home, board, configurações, templates, capacidade, contratos, portfólio), claro e escuro |

A meta de cobertura de domínio ≥80% (`CLAUDE.md` §5) foi **atingida e superada** em ambos os
pacotes medidos. A suíte E2E e as 13–14 falhas de integração da API expuseram **bugs reais e
pré-existentes** de prompts anteriores (listados em detalhe no §3) — nenhum foi corrigido pela
frente de Testes do Prompt 16 de propósito (medir e cobrir é escopo próprio; corrigi-los é da
frente/prompt original de cada um).

## 3. Resultados de carga (k6, sandbox de 4 vCPU/16 GB — não representativo de produção)

Ferramentas em `tools/load/` (`pnpm load:items`, `pnpm load:realtime`); números completos e
`EXPLAIN ANALYZE` em `tools/load/README.md`.

- **Lista de itens de board (50 mil itens), ordenação por coluna customizada**: causa raiz
  encontrada e corrigida (join estrutural impedia o uso dos índices compostos existentes) —
  `EXPLAIN ANALYZE` isolado caiu de 338 ms para 42–90 ms; p95 a 10 VUs caiu de 762 ms para 551 ms, a
  50 VUs de 3,42 s para 1,96–2,2 s. **A meta de p95 < 200 ms segue sem ser alcançada sob
  concorrência** (10/50 VUs) neste sandbox de CPU compartilhada — por contenção de CPU real
  (`load average` até 16 observado), não mais pela forma da consulta.
- **Ordenação por nome / sem ordenação, boards grandes**: ainda faz table scan do board inteiro —
  mais barato que o caso de coluna customizada, mas não otimizado. Pendente.
- **Propagação realtime < 300 ms**: protocolo implementado e validado ponta a ponta, mas **não
  medida nesta sessão** — bloqueada por um bug isolado em `AccessService.can()` para `'board.read'`
  sob desenvolvimento concorrente (ADR 0057/0058), fora do escopo da frente de performance.
- Cache de permissões e o novo `BoardCacheService` confirmados efetivos (poucas faltas sob
  chamadas repetidas).

## 4. Riscos remanescentes

**Segurança/compliance** (detalhe em `docs/security.md` §7, `docs/lgpd.md`):
- Sem SLO SAML nem assinatura de `AuthnRequest` pelo SP.
- Allowlist de IP/domínio aplicada só no login, não a cada requisição subsequente.
- Exportação LGPD não cobre comentários/itens responsável/apontamentos de horas.
- Sem auditoria de segurança externa/pentest realizada sobre este código.
- Retenção de auditoria com granularidade mensal, não por dia exato.

**Billing** (`docs/billing.md` §5):
- Nenhuma chamada real ao Stripe foi exercitada (sem chave de teste neste sandbox) — integração
  escrita e testada contra a porta injetável, nunca fingida como testada contra a API real.
- Pix/boleto é um stub deliberado (sem PSP real integrado).
- Sem conceito de operador de plataforma cross-tenant.

**Performance**:
- p95 < 200 ms não alcançado sob concorrência (10/50 VUs) — ver §3.
- Propagação realtime < 300 ms não medida (bug bloqueador identificado, não corrigido nesta frente).
- Ordenação por nome/sem ordenação em boards grandes ainda sem índice dedicado.

**Infraestrutura/deploy** (`docs/deploy.md` §9 — nada testado contra recursos reais que este
sandbox não tem):
- Sem cluster Kubernetes real nem credenciais — `helm upgrade --install` nunca executado de
  verdade, só `helm lint`/`helm template`.
- Sem bucket S3 real de staging/produção — backup e teste de restauração via S3 não exercitados
  (a validação local dump→restauração→migração roda e prova o mecanismo).
- Dashboards Grafana nunca abertos num Grafana real — PromQL escrito contra métricas confirmadas,
  mas renderização visual não verificada.
- Sentry citado na stack (`CLAUDE.md` §3) mas não integrado na aplicação.

**Bugs reais encontrados pela frente de Testes, não corrigidos** (listados com arquivo e causa raiz
observada em `docs/roadmap.md`, seção "Testes" do Prompt 16 — 19 falhas E2E reproduzidas de forma
idêntica em duas execuções, mais 13–14 falhas de integração da API): automações, capacidade,
dashboards, governança/riscos, painel do item (menção/atividade/aprovação em tempo real),
planejamento (Gantt), portfólio (arquivo inteiro), processos/SLA (arquivo inteiro), timesheet,
gestão de views — a maioria em specs nunca antes executados nesta sessão. Padrão recorrente
identificado: vários controllers retornam 201 em vez de 200 para ações sobre recurso existente
(faltando `@HttpCode(200)`); vários `*.e2e.test.ts` têm só `beforeAll`/`afterAll` (não
`beforeEach`), sugerindo contaminação de estado entre testes do mesmo arquivo.

## 5. Backlog recomendado (priorizado)

1. **Corrigir os 19 bugs reais de E2E + 13–14 de integração** listados em `docs/roadmap.md` (cada
   um já tem arquivo e causa raiz observada) — maior risco de produção já identificado e não corrigido.
2. **Resolver o bug de `AccessService.can()` para `'board.read'`** e então medir propagação
   realtime (`pnpm load:realtime`) — pré-requisito para validar o princípio de produto "tempo real
   p95 < 300 ms" (`CLAUDE.md` §2).
3. **Otimizar o caminho de ordenação por nome/sem ordenação** em boards grandes (mesma família do
   problema já corrigido para coluna customizada).
4. **Isolar o estado entre testes de integração** (`beforeEach` em vez de só `beforeAll`) nos
   arquivos identificados — evita falsos positivos/negativos futuros.
5. **Adicionar `@HttpCode(200)`** aos endpoints de ação sobre recurso existente que hoje retornam
   201 por engano (`webhooks`, `planning`/baselines, `portfolio` stage-gate/what-if).
6. Integrar Sentry na aplicação (`apps/api`/`apps/worker`), conforme já previsto em `CLAUDE.md` §3.
7. Validar, num ambiente com cluster/S3/Grafana reais, os três pontos de `docs/deploy.md` §9 antes
   do primeiro deploy de produção.
8. Obter uma chave de teste do Stripe e validar o fluxo de checkout/webhook ponta a ponta contra a
   API real antes de habilitar cobrança em produção.
9. Avaliar PSP real para Pix/boleto (hoje stub deliberado) se o mercado-alvo exigir esses métodos.
10. Pentest/auditoria de segurança externa antes de expor a plataforma a clientes de órgãos
    públicos (contratos/UST), dado o perfil de dado sensível (LGPD).

## 6. Como validar este relatório

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm --filter @cube-track/shared test:coverage
cd apps/api && npx vitest run domain --coverage && cd ../..
pnpm lint && pnpm typecheck
pnpm --filter @cube-track/db test && pnpm --filter @cube-track/api test && pnpm --filter @cube-track/worker test
pnpm --filter @cube-track/web test
pnpm --filter @cube-track/worker start &
pnpm --filter @cube-track/web test:e2e
pnpm load:items && pnpm load:realtime   # requer k6 instalado — ver tools/load/README.md
```
