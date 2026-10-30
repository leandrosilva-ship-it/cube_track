# Contratos/OS/UST

Módulo opcional por workspace (ADR 0017) para consultorias que faturam por **UST** (Unidade de
Serviço Técnico) — o caso de referência do produto, consultoria que atende órgãos públicos. Contrato →
Ordem de Serviço (OS) → Medição mensal → Fatura, com saldo de UST sempre calculado ao vivo. Decisões
de arquitetura em `docs/adr/0054-contratos-os-ust.md`.

## 1. Visão geral

O módulo é **opcional** (`enabledModules` do workspace, ADR 0017): workspaces fora desse setor não o
veem — as rotas somem (404) e o item de menu some da UI. Quando ativo, cada **Contrato** tem uma
vigência, um valor de UST contratada, um preço unitário de UST e um **catálogo de serviços** (Código
Edital) com a UST padrão de cada serviço. O trabalho operacional (itens do board) vira **Ordens de
Serviço**, cada uma com linhas de catálogo × quantidade, percorrendo um ciclo de vida até ser aceita,
medida e faturada.

## 2. Conceitos de domínio

| Conceito                      | Descrição                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Contrato**                   | Vigência (`startDate`/`endDate`), `ustContracted`, `ustUnitPrice`, `totalValue`, status (`draft`/`active`/`suspended`/`closed`), gestor (`managerId`). |
| **Catálogo de Serviços (Código Edital)** | Itens do contrato (`code`, `name`, `defaultUst`, `unit`) — a UST padrão que preenche automaticamente uma linha de OS. |
| **Ordem de Serviço (OS)**      | Demanda vinculada a um board/item, com linhas de catálogo × quantidade; `totalUst` é sempre a soma das linhas.         |
| **Linha da OS**                | Código Edital × quantidade → `ustTotal` (`computeServiceOrderItemUst`, 4 casas decimais, mesma precisão do `check` de banco). |
| **Medição**                    | Consolidado mensal de UST consumida (soma das OS aceitas do período) menos glosa, por contrato.                       |
| **Fatura**                     | Nasce de uma medição **aprovada**; herda `contractId` e `amount` da medição.                                          |

### Ciclo de vida da OS

```
draft → requested → issued → in_progress → delivered → accepted → measured → invoiced
```

Sequência linear e estrita (`apps/api/src/modules/contracts/application/service-orders.service.ts`,
`isValidTransition`): só é possível avançar uma posição por vez (não pula etapas) e não retroceder.
`cancelled` é alcançável de qualquer status não-terminal (menos `cancelled`/`invoiced`); `invoiced` é
o único status realmente terminal. Datas automáticas gravadas pela própria transição:
`requested → requestedAt`, `issued → issuedAt`, `delivered → deliveredAt`, `accepted → acceptedAt`,
`invoiced → billedAt`.

## 3. Saldo de UST — sempre calculado ao vivo

O saldo do contrato **nunca é armazenado**: é recalculado a cada leitura (`computeContractBalance`,
`packages/shared/src/contracts.ts`), somando a `totalUst` de todas as OS do contrato cujo status está
em `CONSUMING_ORDER_STATUSES` (`accepted`/`measured`/`invoiced`). OS em `draft`/`requested`/`issued`/
`in_progress`/`delivered` não descontam saldo — refletem só uma expectativa; `cancelled` nunca consome.

```
ustBalance = ustContracted − ustConsumed
percentConsumed = ustConsumed / ustContracted × 100   (0 se ustContracted = 0)
```

É esse cálculo sob demanda, sem motor de recálculo assíncrono, que faz o critério de aceite "saldo do
contrato atualizado automaticamente a cada OS aceita" ser verdade **por construção**: assim que a OS
muda de status para `accepted`, a próxima leitura do contrato (`GET /v1/contracts/:id`) já reflete o
novo saldo, e o evento `service_order.changed` avisa qualquer sessão com a tela aberta para buscar o
contrato de novo.

## 4. Auto-preenchimento de UST e override auditado

Ao adicionar uma linha à OS (`POST service-orders/:id/items`), a UST por unidade (`ustUnit`) é
preenchida com o `defaultUst` do item de catálogo escolhido. Um `ustUnit` diferente do padrão exige
`ustOverrideReason` não vazio — sem justificativa, a API recusa com 400
(`path: 'body.ustOverrideReason'`, `ServiceOrderItemsService.resolveUstUnit`). O ajuste e sua
justificativa são auditados (`DomainEvents.recordChange`), junto com a quantidade e o item de catálogo
antes/depois. `ustTotal` é sempre recalculado (`computeServiceOrderItemUst(quantity, ustUnit)`, nunca
editável diretamente) e o total da OS é sempre recomputado como a soma das linhas
(`ServiceOrdersService.recomputeTotal`). Uma OS já **aceita, medida, faturada ou cancelada** não aceita
mais alteração de linhas (`service_order_locked`).

## 5. Medição mensal — reconciliação por construção

`POST contracts/:id/measurements/generate` gera (ou regenera, se ainda `draft`/`submitted`) a medição
de um período: `measuredUst` é sempre a **soma real** das OS do contrato em `CONSUMING_ORDER_STATUSES`
cuja `acceptedAt` cai no período informado — nunca digitado à mão
(`reconcileMeasurement`, `packages/shared/src/contracts.ts`). É isso que faz o critério de aceite "o
relatório de medição mensal confere com a soma dos itens" verdadeiro por construção, não por
conferência manual depois do fato. Fluxo:

1. **`generate`** (rascunho) — soma as OS aceitas do período; regenerar recalcula `measuredUst` e
   limita a glosa já lançada ao novo total.
2. **`update`** — ajusta `glosaUst`/`notes` enquanto a medição não foi decidida.
3. **`decide`** (`approved`/`rejected`) — ao aprovar, recalcula `approvedUst = measuredUst − glosaUst`
   (nunca negativo) e `amount = approvedUst × ustUnitPrice` do contrato
   (`computeInvoiceAmount`); uma medição decidida não pode mais ser alterada.

Uma fatura (`POST measurements/:id/invoice`) só nasce de uma medição **aprovada**, herdando
`contractId` e `amount` dela.

## 6. Alertas e job diário

`packages/shared/src/contracts.ts` define três tipos de alerta, puros e testados:

| Alerta                   | Condição                                                                                     | Aviso → crítico                          |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `low_balance`              | Saldo restante ≤ 15% do contratado                                                               | ≤ 15% → aviso; ≤ 7,5% → crítico             |
| `expiring`                 | Vigência termina em até 60 dias                                                                   | ≤ 60 dias → aviso; ≤ 15 dias → crítico      |
| `service_order_stalled`    | OS em `requested` há ≥ 5 dias corridos sem emissão                                               | ≥ 5 dias → aviso; ≥ 10 dias → crítico       |

`ContractsService.toDto` avalia saldo baixo e vigência a cada leitura do contrato (aparecem no corpo
da resposta, `alerts`/`stalledOrders`). O **job diário do worker**
(`apps/worker/src/processors/contracts.ts#createContractAlertsDaily`) roda para todo contrato `active`
(candidatos de `app.contract_alert_candidates()`, função `SECURITY DEFINER` de superfície mínima —
só `tenant_id`/`contract_id`, mesmo padrão de `app.sla_tracker_alerts()`/
`app.portfolio_health_candidates()`), reavalia os três alertas em TypeScript com o mesmo motor
testado, e **notifica o gestor do contrato** (`contracts.managerId`) por notificação in-app
(`contract_alert`) e e-mail, quando o contrato tiver um gestor definido. Um contrato sem
`managerId` não gera notificação nem e-mail (os alertas continuam visíveis na tela do contrato).

## 7. Widgets de dashboard

Três tipos de widget (`packages/shared/src/widgets.ts`), calculados por
`apps/api/src/modules/dashboards/application/widget-data.service.ts`:

| Tipo                | O que mostra                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `ust_balance`         | Saldo atual do contrato (contratado/consumido/restante/%), mesmo `ContractBalance` da tela de contrato. |
| `ust_by_dimension`    | UST consumida (OS aceitas/medidas/faturadas) agrupada por mês, ou por um bucket de coluna de um board (ex.: por fase). |
| `ust_forecast`        | Previsão de esgotamento do saldo (`forecastExhaustion`): taxa média de consumo diário no histórico de aceites, projetada linearmente sobre o saldo atual. |

## 8. Habilitação do módulo

Em **Configurações do Workspace** (`apps/web/src/features/workspace/workspace-settings-page.tsx`),
quem tem `workspace.manage` marca/desmarca `contracts` na lista de módulos opcionais
(`PATCH /v1/workspaces/:id` com `enabledModules`). Com o módulo desativado:

- as rotas de `apps/api/src/modules/contracts/` respondem 404 (`assertModuleEnabled`, verificado em
  toda ação de escrita e leitura do contrato e propagado por `ContractsService.assertManage`/
  `assertRead`/`assertMeasure` para catálogo, OS, medição e fatura);
- o item de menu e as telas do módulo somem da UI;
- **os dados existentes são preservados** — reativar o módulo os traz de volta intactos (mesma
  garantia da ADR 0017 para qualquer módulo opcional).

## 9. Permissões

Três permissões de workspace novas: `contract.read`, `contract.manage`, `contract.measure` — ver
`docs/permissions.md` §"Contratos/OS/UST" para o detalhamento por operação. A exigência dupla de
Ordens de Serviço (`board.manage` do board vinculado OU `contract.manage` do workspace do contrato)
está documentada na mesma seção.

## 10. Colunas vinculadas (`service_order.*`)

Um board com contrato (`boards.contractId`) pode expor colunas vinculadas (`binding`) aos campos da
OS do item: `service_order.number`, `.sei_process`, `.requested_at`, `.issued_at`, `.total_ust`,
`.catalog_codes` (códigos das linhas, agregados) e `.billed_at`
(`packages/shared/src/columns/registry.ts`, `COLUMN_BINDINGS`). A resolução acontece em lote por
página de itens (`ItemsRepository.serviceOrderSummaries`), só quando o board realmente tem alguma
coluna com esse binding — mesma economia de não fazer join à toa que as colunas `item.*`.

## 11. Limitações conhecidas

Documentadas honestamente, no mesmo espírito do restante do projeto (ex.: `docs/portfolio.md` §7):

- **Colunas `service_order.*` são somente leitura em filtros/ordenação da Tabela.** O resolvedor de
  binding de filtro/ordenação (`ItemQueryBuilder.bindingField`,
  `apps/api/src/modules/work/infrastructure/item-query.ts`) só reconhece bindings que começam com
  `item.`; um binding `service_order.*` sempre cai em `null` e a coluna não entra na compilação do
  filtro/ordenação — ela aparece e é editável como qualquer coluna de exibição, mas não pode ser usada
  para filtrar nem ordenar a Tabela. Não há aviso na UI além da ausência da coluna nos seletores de
  filtro/ordenação.
- **A medição agrega por mês/contrato, não por OS individual.** `measurements.serviceOrderId` existe
  no schema (FK opcional, pensada para uma medição por OS) mas **não é usado** neste modelo: uma
  medição gerada por `generate()` sempre soma **todas** as OS aceitas do contrato cujo `acceptedAt`
  cai no período — não existe hoje uma medição de uma única OS. Uma consultoria que precise medir OS
  individualmente (em vez de consolidar o mês inteiro) não tem suporte direto nesta entrega.
- **Notificação do gestor do contrato só no alerta diário, nunca na atribuição.** Definir ou trocar o
  `managerId` de um contrato (criação ou `PATCH /contracts/:id`) não dispara nenhuma notificação para
  o novo gestor — ele só passa a receber algo quando o job diário encontrar um alerta ativo (saldo
  baixo, vigência perto do fim ou OS parada). Mesmo padrão de lacuna documentado no Prompt 12 para
  `risk_assigned`/`issue_assigned` (que ao menos notificam na criação; aqui não há notificação de
  atribuição alguma).
- **Catálogo de serviços não é um tipo de coluna genérico.** Diferente de um "lookup" reutilizável, o
  vínculo Código Edital × linha da OS é uma funcionalidade dedicada do módulo (não existe um tipo de
  coluna `lookup` no projeto) — não é possível reaproveisar esse mecanismo de auto-preenchimento +
  override auditado para relacionar outras entidades fora de Contratos/OS/UST.
- **UST não entra no rollup de portfólio** (Prompt 12): `aggregateRollup` sempre soma `0` de UST —
  ligar os dois módulos (rollup de portfólio somando a UST consumida dos contratos dos boards) fica
  para um prompt futuro.
- **Testes de integração (API/worker) e E2E Playwright**: escritos nesta entrega
  (`apps/api/test/contracts.e2e.test.ts`, 2 cenários nomeados exatamente pelos 2 critérios de aceite
  do prompt) — ver `docs/roadmap.md` (entrada do Prompt 13) para o estado de execução observado nesta
  sessão.

## 12. Critérios de aceite

- ✅ **Saldo do contrato atualizado automaticamente a cada OS aceita** — `computeContractBalance`
  recalcula ao vivo a cada leitura, a partir do status atual das OS (`CONSUMING_ORDER_STATUSES`);
  testado em `packages/shared/src/contracts.test.ts` e em
  `apps/api/test/contracts.e2e.test.ts` ("saldo do contrato só muda quando a OS chega a 'aceita'").
- ✅ **Relatório de medição mensal confere com a soma dos itens** — `reconcileMeasurement` soma as OS
  aceitas do período por construção, nunca por digitação manual; testado em
  `packages/shared/src/contracts.test.ts` e em `apps/api/test/contracts.e2e.test.ts` ("medição do
  período de hoje confere exatamente com a soma das OS aceitas no período").

## 13. Como rodar e testar

```bash
pnpm infra:up && pnpm db:reset && pnpm db:seed
pnpm build
pnpm --filter @cube-track/api start      # API :3001
pnpm --filter @cube-track/worker start   # relay + alertas diários de contrato
pnpm --filter @cube-track/web start      # web :3000 — ana.ribeiro@empresademo.com.br / CubeTrack@2026
pnpm --filter @cube-track/shared test    # motor de contratos (contracts.test.ts)
pnpm --filter @cube-track/web test       # modelo do feature contracts (model.test.ts)
pnpm --filter @cube-track/api test       # contracts.e2e.test.ts
pnpm --filter @cube-track/web test:e2e   # fluxos de Contratos/OS/UST em tempo real
```
