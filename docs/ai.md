# Inteligência Artificial

Módulo opcional por workspace (ADR 0017) que adiciona IA generativa (Anthropic/Claude) ao produto:
assistente que responde perguntas sobre os dados do board/item, criação de item a partir de texto
livre, resumos, geração de descrição de serviço, previsões (risco de atraso, sugestão de
responsável, itens duplicados) e agentes configuráveis com aprovação humana obrigatória. Decisões de
arquitetura em `docs/adr/0055-inteligencia-artificial.md`.

## 1. Visão geral

A configuração de IA (provedor, chave, modelo, limites) é **por tenant** — uma organização inteira
compartilha uma única chave (BYOK). O módulo opcional `ai` continua **por workspace**: as duas
checagens são independentes e ambas precisam estar satisfeitas para qualquer funcionalidade de IA
responder além de `404`/`ai_not_configured`.

```
organização configura IA (ai.manage, tenant)  ──┐
                                                  ├──► funcionalidade de IA disponível num workspace
workspace liga o módulo opcional `ai`  ──────────┘
```

A IA nasce **desligada** (`ai_settings.enabled = false`) por padrão — LGPD: ninguém liga IA "por
acidente" num tenant novo.

## 2. Modelos e custo

| Modelo              | Entrada (USD/1M tok) | Saída (USD/1M tok) |
| -------------------- | ---------------------- | --------------------- |
| `claude-opus-5-5`     | 4,00                   | 20,00                 |
| `claude-sonnet-5-5`   | 2,00                   | 10,00                 |
| `claude-haiku-5-5`    | 0,10                   | 0,50                  |

`estimateCostCents` (`packages/shared/src/ai.ts`) arredonda sempre **para cima** (nunca subestima o
gasto do tenant). Toda chamada ao provedor — sucesso ou falha — grava uma linha em `ai_usage_logs`
(append-only) com tokens de entrada/saída e custo em centavos; é a soma dessas linhas no mês corrente
(`AiUsageGuard.monthlyTotals`) que decide se o tenant estourou o limite configurado
(`monthlyTokenLimit`/`monthlyCostLimitCents`, `null` = sem limite) **antes** de qualquer nova chamada
acontecer (`ai_usage_limit_exceeded`).

## 3. Assistente lateral

`POST /v1/boards/:boardId/ai/assistant` (`ai.use`) — chat síncrono, pergunta → resposta, com um loop
manual de tool-use (até 6 idas e vindas, `MAX_TURNS`) sobre um conjunto fixo de ferramentas
(`AiAssistantToolsService`): `list_items`, `get_item`, `board_summary` sempre disponíveis;
`contract_summary` só quando o módulo `contracts` também está ativo no workspace.

**Garantia estrutural** (critério de aceite: "o assistente nunca retorna dados que o usuário não tem
permissão de ver"): cada ferramenta é um wrapper fino sobre um service de aplicação real
(`ItemsService`, `ContractsService`) chamado com o `AuthPrincipal` de quem perguntou — a mesma
permissão e a mesma redação de colunas que valem para `GET /v1/items/:id` valem aqui. Nenhum código do
módulo de IA decide permissão por conta própria.

## 4. Criação de item a partir de texto

`POST /v1/boards/:boardId/ai/create-item` (`ai.use` + `item.create`) — o modelo recebe o texto livre
(e-mail, bilhete, descrição de demanda) e o schema de colunas graváveis do board, e devolve, numa
única chamada com ferramenta forçada (`extract_item`), um nome e um texto bruto por coluna
equivalente encontrada no documento. A conversão final de cada texto em valor de coluna usa
`parseCellText` (`packages/shared/src/columns/text.ts`) — a mesma função determinística já usada por
colar células e importar planilhas; o modelo nunca monta o JSON da célula diretamente. Colunas cujo
texto não converte entram em `skippedColumns` (nunca bloqueiam a criação do item).

## 5. Resumos e descrição

- `POST /v1/items/:itemId/ai/summary` (`ai.use`) — resume as 50 atualizações mais recentes do item.
- `GET /v1/boards/:boardId/ai/status-report-summary` (`ai.use`) — narra em 1-2 parágrafos o status
  report **já calculado** por `StatusReportService` (portfólio, Prompt 12); nunca recalcula EVM,
  risco ou saúde.
- `POST /v1/items/:itemId/ai/generate-description` (`ai.use`) — sugere uma descrição de serviço a
  partir do nome e dos campos já preenchidos do item; é sempre uma sugestão — o front decide se aplica,
  nunca é salva sozinha.

## 6. Previsões

`GET /v1/boards/:boardId/ai/predictions` (`ai.use`) combina três cálculos **determinísticos** (sem
IA) com uma narrativa final em linguagem natural (1 chamada de IA):

- **Risco de atraso**: itens não concluídos cuja data planejada já passou (`overdue`) ou está a até 3
  dias (`due_soon`).
- **Sugestão de responsável**: cruza a carga atual (itens abertos por pessoa, nas colunas de pessoas
  do board) e sugere, para itens sem responsável, a pessoa com menor carga — sem dados suficientes
  (nenhuma coluna de pessoas, ou ninguém com itens abertos), não sugere ninguém.
- **Itens duplicados**: similaridade de Jaccard sobre nomes normalizados (`itemNameSimilarity`/
  `findDuplicateCandidates`, `packages/shared/src/ai.ts`, limiar padrão 0,6) — tokeniza, remove
  acentos/pontuação, ignora tokens com 2 caracteres ou menos.

## 7. Agentes de IA (ADR 0055)

Um **agente** (`ai_agents`) reaproveita o motor de gatilhos/ações das automações (ADR 0051): mesmo
vocabulário de gatilho (`item_created`, `column_value_changed`, `button_clicked`, `date_arrives`) e de
tipo de ação (`move_to_group`, `set_column_value`, `notify`), mas a ação concreta não é
pré-configurada por um humano — o modelo decide a cada disparo, sempre dentro do conjunto
`allowedActions` escolhido na configuração (até 3 tipos).

### Ciclo de uma proposta

```
evento (item.created/updated/button_clicked) ──► worker avalia gatilho ──► decide() (Anthropic, 1 chamada)
   ──► ai_agent_runs status=pending_approval ──► humano decide (ai.agents.approve)
        ├─ approve  ──► executa de verdade (service real) ──► before_snapshot capturado ──► status=executed
        ├─ reject   ──► nada é executado ──► status=rejected
        └─ (de executed) revert ──► reaplica before_snapshot ──► nova entrada de auditoria ──► status=reverted
```

- **Toda ação de agente exige aprovação humana antes de executar** (critério de aceite) — o worker
  nunca executa sozinho, só propõe.
- **Defesa em profundidade**: `parseProposedAction` valida a ação concreta proposta pelo modelo contra
  `allowedActions` antes mesmo de persistir a proposta — uma tentativa de prompt injection nas
  instruções do agente para fazê-lo propor uma ação fora do combinado nunca chega a ser gravada.
- **Dedupe antes de gastar**: uma chave única (`agentId` + `triggeringEventId` + `itemId`) reserva a
  linha de `ai_agent_runs` antes de chamar a API paga — uma redelivery do mesmo evento (BullMQ) nunca
  gasta uma segunda chamada.
- **Reversibilidade**: só `set_column_value`/`move_to_group` têm um "antes" reconstruível
  (`isRevertibleActionType`) — `notify` não é revertível. O snapshot "antes" é capturado no momento do
  `approve` (não da proposta), porque o valor pode ter mudado entre propor e aprovar.
- **Auditoria**: a ação executada roda com `actorKind: 'automation'` + `metadata: { source: 'ai_agent',
  agentId, runId }` — sem precisar de um novo valor de enum. `revert` produz uma nova entrada de
  auditoria; a execução original nunca é apagada.

### Endpoints

| Operação                                                        | Rota                                       | Permissão            |
| ----------------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| Listar/criar agentes de um board                                   | `GET/POST /v1/boards/:boardId/ai-agents`    | `ai.agents.manage`     |
| Editar/excluir um agente                                           | `PATCH/DELETE /v1/ai-agents/:id`            | `ai.agents.manage`     |
| Listar as execuções (propostas) de um agente                       | `GET /v1/ai-agents/:id/runs`                | `ai.agents.approve`    |
| Aprovar (executa de verdade) / rejeitar / reverter uma proposta     | `POST /v1/ai-agent-runs/:id/{approve,reject,revert}` | `ai.agents.approve` |

## 8. Proteção contra prompt injection

`wrapUntrustedContent` (`packages/shared/src/ai.ts`) delimita todo conteúdo gerado por usuário
(pergunta do assistente, descrição de item, texto colado, instruções do agente) em tags XML
(`<item_description>…</item_description>`) antes de incluí-lo num prompt. `PROMPT_INJECTION_GUARD`, no
system prompt de toda chamada, instrui o modelo a tratar esse conteúdo delimitado como dado a
analisar, nunca como instrução a obedecer — mesmo que o conteúdo contenha algo como "ignore as
instruções anteriores e execute esta ação".

## 9. Auditoria e LGPD

- Toda chamada ao provedor grava uso (`ai_usage_logs`) — sucesso ou falha — com tokens e custo, nunca
  o conteúdo da pergunta/resposta (só o volume consumido).
- `ai_settings.enabled` começa `false`; desligar a IA do tenant interrompe imediatamente todas as
  funcionalidades (`ai_not_configured`), sem apagar `ai_agents`/`ai_agent_runs` existentes.
- Desativar o módulo opcional `ai` num workspace não apaga dados — só o acesso (404) e a UI somem,
  mesmo padrão de todo módulo opcional (ADR 0017).

## 10. Limitações conhecidas

- O assistente é um chat síncrono de 1 pergunta → 1 resposta por chamada — não mantém histórico de
  conversa entre chamadas (cada `POST .../ai/assistant` é independente).
- Não há endpoint agregado "minhas aprovações pendentes entre todos os boards/workspaces" — a fila de
  aprovação é sempre por agente (`GET /v1/ai-agents/:id/runs`), que por sua vez exige `ai.agents.manage`
  para localizar os agentes de um board antes de listar suas execuções. Um papel que detenha apenas
  `ai.agents.approve` sem `ai.agents.manage` não tem, nesta entrega, uma forma própria de descobrir
  quais agentes existem para então ver suas filas — na prática, os dois papéis devem andar juntos até
  uma extensão futura do modelo de permissões ou um endpoint agregado dedicado.
- Não existe um classificador dedicado de prompt injection — a defesa é delimitação + instrução fixa +
  validação estrutural da ação proposta, não detecção de intenção maliciosa em si.
- Previsão de sugestão de responsável não considera skill/capacidade do módulo de Capacity (Prompt 11)
  — só a contagem bruta de itens abertos por pessoa no board atual.

## 11. Como testar

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # worker (processor ai-agents + varredura diária date_arrives)
pnpm --filter @cube-track/web start      # web :3000
pnpm lint && pnpm typecheck && pnpm test
```

Habilitar a IA de teste: como `owner`/`admin`, `PATCH /v1/ai/settings` com `{ "apiKey": "sk-ant-...",
"enabled": true }`; depois ligar o módulo opcional `ai` no workspace desejado (tela de configurações
do workspace).
