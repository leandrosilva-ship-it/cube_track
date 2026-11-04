# ADR 0055 — Inteligência Artificial (API Anthropic)

- **Status:** Aceita
- **Data:** 2026-11-04
- **Prompt:** 14

## Contexto

O Prompt 14 entrega a camada de IA do produto: provedor Anthropic (Claude) com chave por tenant
(BYOK), limites de uso/custo, registro de custo para auditoria de LGPD, assistente lateral que
responde perguntas sobre os dados do board/item, criação de item a partir de texto livre, resumos
(atualizações do item, status report narrado), geração de descrição de serviço, previsões
determinísticas narradas por IA (risco de atraso, sugestão de responsável, itens duplicados) e
agentes configuráveis que reaproveitam o motor de gatilhos/ações das automações (ADR 0051) com
aprovação humana **obrigatória** antes de qualquer execução. Módulo opcional por workspace (`ai`,
ADR 0017, já reservado desde então). Detalhe funcional em `docs/ai.md`.

Tabelas novas: `ai_settings` (uma linha por tenant), `ai_usage_logs` (append-only), `ai_agents`,
`ai_agent_runs` (`packages/db/src/schema/ai.ts`), todas `tenant_id` + RLS. Migrações: schema inicial
(`0024`), RLS/triggers/`app.ai_agent_date_check_candidates()` (`0025`), catálogo de permissões
(`0026`).

## Decisões

### Dois processos, duas responsabilidades: assistente síncrono na API, agentes assíncronos no worker

- O **assistente** (`AiAssistantService`) roda inteiramente na API, onde o Nest DI injeta services de
  aplicação reais (`ItemsService`, `ContractsService` etc.) com o `AuthPrincipal` de quem pergunta —
  é essa composição, e não uma lista de permissões própria do módulo de IA, que garante por
  construção o critério de aceite "o assistente nunca retorna dados que o usuário não tem permissão
  de ver": cada ferramenta (`AiAssistantToolsService`) é um wrapper fino sobre um service que já
  decide permissão e já redige colunas restritas; nenhum método do módulo de IA decide permissão
  sozinho.
- Os **agentes** avaliam o gatilho e decidem a ação no worker (`apps/worker/src/processors/ai-agents.ts`),
  onde não existe Nest DI — mesmo padrão `runAsSystem`/SQL direto já estabelecido pelas automações
  (ADR 0051). O worker **nunca executa** a ação de verdade: só grava uma linha
  `ai_agent_runs` com `status: 'pending_approval'`. A execução de fato acontece na API, numa
  transação própria, só quando um humano aprova (`AiAgentsService.approve`).
- Consequência: o provedor Anthropic tem **duas implementações mínimas** (`apps/api/.../ai-provider.ts`
  com o loop de tool-use do assistente; `apps/worker/src/ai-provider.ts` com uma chamada de 1 turno e
  saída forçada para a decisão do agente) — deliberado, não duplicação acidental: a interface que cada
  processo precisa é pequena e diferente, e compartilhar uma classe exigiria dar ao worker acesso ao
  Nest DI da API ou extrair um terceiro pacote só para isso.

### Reaproveita o motor de gatilhos/ações das automações em vez de duplicá-lo

- `AiAgentConfig` (`packages/shared/src/ai.ts`) usa diretamente `parseTrigger`/`parseActions`/
  `AutomationTriggerSpec`/`AutomationActionType` de `packages/shared/src/automations.ts` — mesmo
  vocabulário de gatilho (`item_created`, `column_value_changed`, `button_clicked`, `date_arrives`) e
  de tipo de ação (`move_to_group`, `set_column_value`, `notify`) das automações determinísticas
  (ADR 0051). Um agente de IA **não é** um novo motor de regras; é uma automação cuja ação não é
  pré-configurada por um humano, mas decidida pelo modelo a cada disparo, sempre dentro do conjunto
  `allowedActions` escolhido na configuração.
- **Defesa em profundidade**: `parseProposedAction` valida a ação concretamente proposta pelo modelo
  contra `allowedActions` antes de persistir qualquer `ai_agent_runs` — mesmo que o modelo "alucine"
  uma ação fora do combinado (ex.: prompt injection nas instruções do agente tentando fazê-lo propor
  `notify` quando só `set_column_value` está permitido), ela nunca chega a ser proposta.
- O valor de coluna que o modelo decide ainda passa por `parseCellText`
  (`packages/shared/src/columns/text.ts`) — a mesma função determinística, já testada, que converte
  texto colado/importado em valor de coluna. O modelo só decide **qual texto** vai em **qual coluna**;
  nunca monta o JSON da célula diretamente.

### Reversibilidade: `before_snapshot` capturado na execução, nunca na proposta

- Só `set_column_value` e `move_to_group` são revertíveis (`isRevertibleActionType`) — `notify` não
  tem um "antes" para restaurar. O `before_snapshot` é lido pelo service real da coluna/grupo no
  momento do `approve` (não quando o worker propõe, porque o valor pode ter mudado entre a proposta e
  a aprovação) e gravado em `ai_agent_runs.before_snapshot`.
- `revert` reaplica esse snapshot através do mesmo service real (nunca um `UPDATE` direto na tabela) e
  produz uma **nova** entrada de auditoria — a entrada original da execução nunca é apagada ou
  reescrita, preservando a trilha completa (proposto → aprovado/executado → revertido).

### Atribuição de autoria sem migração de enum: `actorKind: 'automation'` + `metadata.source`

- O enum `actor_kind` do Postgres (`'user' | 'automation' | 'api' | 'import' | 'system'`) não ganhou
  um valor `'ai_agent'`. Uma ação de agente aprovada roda com `actorKind: 'automation'` (a mesma
  categoria de uma automação determinística) e carrega `metadata: { source: 'ai_agent', agentId, runId }`
  no registro de auditoria/evento — suficiente para distinguir uma ação de IA de uma automação comum
  sem alterar o schema. `approve`/`revert` usam o escape hatch pré-existente
  `@Audited({ transactional: false })` (já usado por outros fluxos que precisam da própria transação
  com um `actorKind` diferente do padrão `'user'` do interceptor) para abrir essa transação própria.

### Configuração de IA é por TENANT, módulo `ai` é por WORKSPACE

- `ai_settings` (provedor, chave cifrada, modelo, limites) é **uma linha por tenant** — diferente de
  `contracts`/`automations`, a organização inteira compartilha uma única configuração/chave, refletindo
  o padrão BYOK pedido no prompt ("chaves por tenant"). `ai.manage` é permissão de escopo **tenant**
  (papéis `owner`/`admin`), reaproveitando `tenant.manage` como precedente de escopo.
- O módulo opcional `ai` em `workspaces.enabledModules` continua por **workspace** (ADR 0017) — as
  duas checagens são independentes e ambas precisam passar: uma organização pode ter a IA configurada
  e habilitada, mas desligar o módulo `ai` num workspace específico (ex.: um workspace de dados
  sensíveis que não deve ter IA nenhuma tocando nele), e vice-versa (módulo ligado no workspace, mas a
  organização ainda não configurou uma chave — `ai_not_configured`).
- `enabled` nasce `false` por padrão (LGPD: ninguém liga IA "por acidente" num tenant novo — só um
  admin que leu os termos liga explicitamente).

### Guarda de uso/custo: um único ponto na API, duplicado minimamente no worker

- `AiUsageGuard` (API) é o único lugar que decifra a chave do tenant, checa `ai_settings.enabled` +
  chave presente (`ai_not_configured`) e o limite mensal de tokens/custo (`isOverUsageLimit`,
  `ai_usage_limit_exceeded`) **antes** de qualquer chamada ao provedor, e grava uma linha de uso
  **depois** de toda tentativa (sucesso ou falha) — essa é a trilha de auditoria de custo/LGPD.
- O worker não tem acesso a esse service injetável; `ai-agents.ts` duplica a mesma lógica de checagem
  (`aiCallContext`/`recordUsage`) direto contra o banco. Duplicação deliberada e mínima (poucas
  dezenas de linhas), não um motor de uso paralelo.
- **Dedupe antes de gastar**: o worker reserva uma linha `ai_agent_runs` via
  `.onConflictDoNothing()` **antes** de chamar a API paga da Anthropic — evita gastar uma chamada paga
  ao reavaliar o mesmo evento após uma redelivery do BullMQ. Se o modelo decide `no_action` ou propõe
  algo inválido, a linha reservada é removida depois.

### Proteção contra prompt injection: delimitação + instrução fixa, não um classificador separado

- `wrapUntrustedContent` (`packages/shared/src/ai.ts`) delimita todo conteúdo gerado por usuário
  (pergunta do assistente, descrição de item, texto colado, instruções do próprio agente — que também
  são "conteúdo de usuário" do ponto de vista do modelo que decide a ação) em tags XML antes de incluí-lo
  num prompt. `PROMPT_INJECTION_GUARD`, uma frase fixa do system prompt, instrui o modelo a tratar esse
  conteúdo como dado a analisar, nunca como instrução a obedecer. Não há um segundo modelo/classificador
  dedicado a detectar injection nesta entrega — a defesa é a combinação de delimitação + instrução +
  defesa em profundidade estrutural (`parseProposedAction` nunca confia cegamente na saída do modelo).

### Previsões: cálculo determinístico, narrativa por IA

- Risco de atraso (datas planejadas vs. hoje) e detecção de duplicados (similaridade de Jaccard sobre
  nomes normalizados, `itemNameSimilarity`/`findDuplicateCandidates`) são **cálculos determinísticos**,
  sem qualquer chamada ao modelo — mais barato, mais rápido e auditável sem ambiguidade. Sugestão de
  responsável cruza a carga atual (itens abertos por pessoa) já visível no board; sem dados
  suficientes, não sugere ninguém (nunca inventa). Só a narrativa final em linguagem natural usa o
  provedor de IA (1 chamada, sem ferramentas) — e por isso ainda conta como "chamada de IA" para
  `ai_not_configured`/limite de uso.

## Alternativas consideradas

- **Tool Runner (beta) do SDK da Anthropic para o loop do assistente**: rejeitado em favor de um loop
  manual (`AiAssistantService`) — o projeto precisa de auditabilidade passo a passo (cada chamada vira
  uma linha de uso/custo) e de controle explícito sobre quando parar (`MAX_TURNS`), mais simples de
  raciocinar e testar do que depender do comportamento do runner beta para um fluxo de produção.
- **Novo enum `actor_kind` com valor `ai_agent`**: rejeitado — exigiria migração e não muda nenhum
  comportamento de RLS/auditoria; `actorKind: 'automation'` + `metadata.source` é suficiente para
  distinguir a origem sem alterar schema.
- **Execução automática de ações de agente sem aprovação (com um modo "confiança alta" opcional)**:
  rejeitado — o critério de aceite do prompt exige aprovação humana para **toda** ação de agente, sem
  exceção; introduzir um modo de auto-execução ficaria para uma decisão de produto futura, não uma
  opção padrão.
- **Classificador dedicado de prompt injection**: adiado — a combinação delimitação + instrução fixa +
  defesa em profundidade estrutural (ação sempre validada contra `allowedActions`) cobre o critério de
  aceite sem o custo/latência de uma segunda chamada de IA por interação.

## Consequências

- O assistente é tão seguro quanto os services que ele chama — qualquer novo recurso exposto como
  ferramenta de IA herda automaticamente as checagens de permissão e redação já existentes desse
  recurso, sem precisar duplicar lógica de acesso no módulo de IA.
- Toda ação de agente fica em `ai_agent_runs`, com proposta, decisão, execução e reversão como estados
  distintos e auditáveis — nunca um `UPDATE` silencioso em nome do agente.
- A organização paga por toda chamada de IA, inclusive as que falham ou estouram limite depois de
  iniciadas — `AiUsageGuard.record` sempre grava, mesmo em erro, o que é a postura conservadora correta
  para custo, mas significa que uma falha de rede no meio de uma chamada cara ainda é contabilizada.
- Desativar o módulo `ai` num workspace não apaga agentes/execuções existentes — só o acesso (404) e a
  UI somem, mesmo padrão de todo módulo opcional (ADR 0017).
- Dois provedores Anthropic mínimos (API e worker) precisam ser mantidos em sincronia manual se o
  formato de chamada da Anthropic mudar — custo aceito pela simplicidade de cada um não depender do
  outro processo.
