# ADR 0060 — Testes: cobertura de domínio, E2E crítico e acessibilidade automatizada

- **Status:** Aceita
- **Data:** 2026-11-12
- **Prompt:** 16

## Contexto

O Prompt 16 pede, na frente de Testes: cobertura ≥80% no domínio (CLAUDE.md §5), E2E Playwright dos
fluxos críticos (login, criar board, configurar Kanban, mover cartão, colaboração entre dois
navegadores, automação, dashboard, importação) e testes de acessibilidade automatizados com axe.
As outras três frentes do Prompt 16 (segurança, performance, billing) já estavam entregues e
commitadas nesta sessão; nenhuma ferramenta de cobertura existia em nenhum `vitest.config.ts` do
monorepo antes desta entrega — precisou ser configurada do zero antes de medir qualquer número.

## Decisões

### Escopo da métrica de cobertura: só o domínio, não o pacote/módulo inteiro

"Cobertura no domínio" (CLAUDE.md §5) significa regras de negócio puras — não controllers, não
repositórios Drizzle, não adaptadores de infraestrutura. Duas configurações de `@vitest/coverage-v8`
(3.2.7, mesma major do Vitest já instalado):

- **`packages/shared`**: todo o pacote É o domínio (fórmulas, agendamento, permissões, portfólio,
  contratos, capacity, billing, security, importadores, templates de board...) — `include: ['src/**/*.ts']`,
  excluindo só barris de re-export puro (`index.ts` dos três níveis) e três arquivos que são contrato/
  tipo puro sem nenhuma linha executável de decisão (`jobs.ts` — nomes de fila e schemas Zod de
  payload; `events.ts` — schemas Zod de evento de domínio; `formula/context.ts` — só interfaces).
  Tratar esses três como "cobertura 0%" mediria a ausência de teste de uma declaração de tipo, não
  uma lacuna de regra de negócio — o mesmo raciocínio que exclui `generated/schema.ts` do `packages/sdk`
  ou um arquivo de migração SQL.
- **`apps/api`**: `include: ['src/modules/*/domain/**/*.ts']` — só a camada `domain/` de cada módulo
  (Clean Architecture, CLAUDE.md §5: "sem Nest, sem Drizzle"). `application/infrastructure/
  presentation` ficam fora da métrica porque são wiring, já medidos pelos `*.e2e.test.ts` de
  integração (que não rodam sob este provider de cobertura, por rodarem contra Postgres real — ver
  "Pendências").

Resultado medido nas duas configurações (comando exato em `docs/roadmap.md`, seção Testes do Prompt
16): `packages/shared` 82,38% → 96,27% linhas/stmts, 78,37% → 81,34% branches, depois de fechar as
lacunas reais descritas abaixo; `apps/api` domain/ 80,42% → 98,1% linhas/stmts, 86,09% → 90,06%
branches. Ambos acima da meta de 80% em toda métrica.

### Fechar lacunas com testes reais, priorizando 0% e módulos recém-escritos

Em vez de inflar o número com `expect(fn()).toBeDefined()`, cada teste novo afirma um comportamento
real: tabela-verdade completa de `columnValueToFormula` (os ~20 tipos de coluna customizada) e de
`sourceValue` (rollup/espelho) em `columns/computed.ts`; os ramos de evento conhecido/desconhecido de
`normalizeGithubEvent`/`normalizeGitlabEvent`/`normalizeAzureDevOpsEvent` em `integrations.ts`; toda a
lógica de `work/domain/board-definition.ts` (coluna de status principal, item concluído, estado do
item para condições, hoje no fuso do tenant) e `forms/domain/form.ts` (deriva o tipo de campo do
formulário a partir da coluna real do board), ambos com 0% de cobertura e nenhum teste antes desta
entrega — a prioridade nº 1 do Prompt 16 ("módulos com 0%, vitória rápida e de alto valor").
`identity/domain` (senha/TOTP/segredos, ADR 0057, escrito nesta mesma janela por uma frente
concorrente) ganhou os casos de borda que a sessão de segurança não cobriu: `isPasswordReused`, a
política configurável do tenant somada à de base, `normalizeRecoveryCode`, `generateTotpSecret`.

### E2E do assistente de importação em background (fluxo crítico sem nenhuma cobertura)

Nenhum spec Playwright exercitava o `ImportWizardDialog` (Prompt 15, ADR 0056 — Monday/Trello/Jira/
Pipefy/CSV em background, processado no worker) — só o importador síncrono de CSV/Excel do Prompt 5
(diferente componente, `table.spec.ts`). "Importação" está explicitamente na lista de fluxos críticos
do Prompt 16. Novo `apps/web/e2e/imports.spec.ts` cobre origem → upload → mapeamento (automático e
manual) → commit → progresso → confirmação, e o caso de linha sem nome (pulada e reportada).

Validar esse spec contra a aplicação real (não só lendo código) encontrou um bug genuíno: o evento
realtime `import_job.changed` (sucesso) só invalidava a consulta do próprio job
(`apps/web/src/realtime/apply.ts`) — como o commit roda inteiro no worker sem evento `item.created`
por linha (decisão de performance documentada no próprio `imports.ts` do worker, para não gerar
milhares de eventos num import grande), a lista de itens do board nunca era invalidada e os itens
importados só apareceriam depois de um reload manual da página, quebrando o critério de pronto
"tempo real entre dois navegadores" para este fluxo. Corrigido (invalida `qk.items(boardId)` quando o
job termina com sucesso) por ser uma correção pequena, no próprio arquivo que este trabalho está
testando — não em outra frente — com teste unitário dedicado cobrindo os três status.

Rodar o spec repetidamente também achou dois bugs reais no PRÓPRIO teste (nunca no produto — o
worker sempre completou a importação em bem menos de 1 segundo, confirmado direto no Postgres):
`getByRole('status')` batia em 2 elementos em modo estrito durante a janela "processando" (o
container do passo e a `Spinner` interna têm, cada um, seu próprio `role="status"`) — `.first()`
resolve; e "0 linhas puladas" nunca aparece em pt-BR porque o CLDR trata 0 como categoria "one"
(singular) neste idioma, não "other" como em inglês. Ambos só aparecem ao rodar de verdade contra o
app — nenhuma leitura de código os revelaria.

### Acessibilidade: estender o spec existente às telas do Prompt 16, não reescrevê-lo

`a11y-responsive.spec.ts` já era uma base real (login/home/board/configurações, claro/escuro,
responsivo mobile). Em vez de duplicar a infraestrutura, um novo `test()` no mesmo arquivo segue o
padrão já estabelecido por `portfolio.spec.ts`/`contracts.spec.ts` (extrair o `workspaceId` da URL do
board aberto) e cobre as cinco telas dos Prompts 11–15 que nunca tinham sido varridas pelo axe:
galeria de Templates, Configurações do workspace (onde vivem as seções de integrações/webhooks/API
tokens/OAuth apps — todas no mesmo `<section>`, sem necessidade de interação para aparecer no DOM),
Capacidade, Contratos e Portfólio.

### Rodar a suíte inteira contra infraestrutura real, não só ler o código

Diferente das sessões anteriores do Prompt 16 (que documentaram "não executado nesta sessão, sandbox
sem Postgres/Redis/Docker" em vários pontos do roadmap), esta sessão tinha PostgreSQL 16 e Redis
nativos já rodando no sandbox — usados para rodar de verdade `packages/db`, `packages/shared`,
`apps/api` (unitário + `*.e2e.test.ts` de integração sob RLS sem BYPASSRLS) e a suíte Playwright
completa (build de produção de `apps/api`/`apps/web`, `apps/worker` iniciado à parte, banco
resetado/semeado). Isso expôs bugs reais pré-existentes, nunca antes executados contra infraestrutura
de verdade — ver `docs/roadmap.md`, seção Testes do Prompt 16, para a lista exata com arquivo e causa
raiz de cada um.

## Decisão sobre os bugs pré-existentes encontrados: reportar, não corrigir nesta frente

Confirmado via `git status`/`git diff` que nenhum dos arquivos com teste falhando (controllers e
processors de automations/webhooks/portfolio/forms/dashboards/planning/board-content/processes/
governance/capacity/timesheet/view-management, motor de EVM e indexação do worker) foi tocado por
esta sessão — são regressões ou lacunas de outras frentes/prompts (7 a 12), a maioria em
especificações `*.e2e.test.ts`/Playwright escritas em sessões anteriores e documentadas como "nunca
executadas" até agora. A suíte Playwright rodou **duas vezes completas** (banco/Redis/worker
resetados entre as duas) para separar sinal de ruído: 19 falhas se repetiram de forma idêntica nas
duas execuções (arquivo, teste e causa aparente iguais — sinal confiável de bug real, não de
instabilidade do sandbox) contra ~9 que falharam só na 1ª execução e passaram limpo na 2ª
(intermitentes sob carga — sandbox de CPU compartilhada e Meilisearch indisponível fazendo o worker
reter tentativas de indexação com backoff exponencial a cada mutação da suíte inteira, suspeita não
confirmada a fundo por estar fora do escopo desta frente). Corrigir as 19 reproduzíveis exigiria
mudar código de domínio/aplicação de pelo menos oito módulos diferentes, fora do escopo desta frente
("Testes") e do mandato explícito de não mexer em arquivos de outras frentes sem uma lacuna de
cobertura pequena e bem justificada — a única exceção aplicada foi a invalidação de cache realtime
acima, por estar no próprio arquivo do fluxo que este trabalho testa (`imports.spec.ts`). Cada
achado está documentado com arquivo e causa raiz observada em `docs/roadmap.md` (seção Testes do
Prompt 16) para a próxima sessão corrigir dentro da frente correta.

## Pendências

- As integrações reais do CI continuam cobertas só por `*.e2e.test.ts`, sem medição de cobertura
  própria (o provider v8 do Vitest não mede processos filhos/servidor separado da mesma forma) — a
  cobertura de domínio mede exatamente a camada pura, e os fluxos de borda ficam coberto pelos E2E.
- Meilisearch não está disponível neste sandbox (só Postgres/Redis nativos) — testes que dependem
  dele (`apps/worker/test/processors.e2e.test.ts`, indexação) continuam pulando essa parte, e é a
  suspeita principal por trás das falhas E2E intermitentes (ver abaixo).
- `apps/web/e2e/table.spec.ts` "50 mil itens" segue pulado (precisa de `pnpm db:seed:large`).
- Lista completa das 19 falhas E2E reproduzidas de forma idêntica nas duas execuções (com causa
  raiz observada por arquivo) e dos 13–14 testes de integração de `apps/api`/`apps/worker`
  pré-existentes: ver `docs/roadmap.md`, seção Testes do Prompt 16 — não repetida aqui para não
  divergir se alguém corrigir um e esquecer o outro lugar.
