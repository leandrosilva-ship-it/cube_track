# ADR 0054 — Contratos/OS/UST

- **Status:** Aceita
- **Data:** 2026-10-30
- **Prompt:** 13

## Contexto

O caso de referência do produto (ADR 0001/CLAUDE.md §1) é uma consultoria que atende órgãos públicos
com contratos medidos em UST (Unidade de Serviço Técnico). O Prompt 13 entrega esse módulo —
**opcional por workspace** (ADR 0017) — cobrindo Contrato, Catálogo de Serviços (Código Edital),
Ordem de Serviço (OS) com ciclo de vida completo, Medição mensal e Fatura, com saldo de UST sempre
calculado ao vivo a partir das OS aceitas. Detalhe funcional em `docs/contracts.md`.

Tabelas novas: `contracts`, `service_catalog_items`, `service_orders`, `service_order_items`,
`measurements`, `invoices` (`packages/db/src/schema/contracts.ts`), todas `tenant_id` + RLS.
Migrações: schema inicial das tabelas (parte do mesmo range aplicado neste prompt),
`0022_service_order_item_override_reason.sql` (coluna `ust_override_reason`, adicionada depois de o
schema inicial já estar migrado, numa correção de curso desta mesma entrega) e
`0023_contract_alert_candidates.sql` (função `app.contract_alert_candidates()` para o cron diário).
`boards.contractId` (FK opcional, para vincular um board inteiro a um contrato) já existia desde o
schema antecipado do Prompt 2.

## Decisões

### Saldo de UST sempre calculado ao vivo, nunca armazenado

- `computeContractBalance` (`packages/shared/src/contracts.ts`) soma a `totalUst` das OS do contrato
  cujo status está em `CONSUMING_ORDER_STATUSES` (`accepted`/`measured`/`invoiced`) e subtrai de
  `ustContracted` — recalculado a cada `GET /v1/contracts/:id` (`ContractsService.toDto`), sem coluna
  de saldo em `contracts` e sem motor de recálculo assíncrono. Mesma filosofia do rollup de portfólio
  (ADR 0053): o número certo é sempre uma função pura dos dados atuais, não um valor cacheado que pode
  divergir.
- Só a partir de `accepted` uma OS "pesa" no saldo — é o critério de aceite do prompt ("saldo
  atualizado automaticamente a cada OS aceita") tomado ao pé da letra: `draft`/`requested`/`issued`/
  `in_progress`/`delivered` refletem só uma expectativa de consumo, não um compromisso fechado;
  `cancelled` nunca consome, mesmo que tivesse avançado bastante no ciclo antes de ser cancelada.

### Módulo opcional via `enabledModules` — 404 quando desabilitado

- `contracts` entra na lista fechada de módulos opcionais (`packages/shared/src/modules.ts`,
  já reservado desde a ADR 0017). Toda ação de `ContractsService` chama `assertEnabled`
  (`assertModuleEnabled`) depois da permissão, e os demais serviços do módulo (catálogo, OS, medição,
  fatura) propagam a checagem via `ContractsService.assertManage`/`assertRead`/`assertMeasure` — um
  único ponto de verdade para "o módulo está ligado neste workspace", em vez de cada serviço repetir a
  consulta a `workspaces.enabledModules`.
- Mesmo padrão de todo módulo opcional (ADR 0017): dados existentes sobrevivem a desativar/reativar o
  módulo — só o acesso (404) e a UI somem.

### Permissão dupla para Ordens de Serviço: `board.manage` OU `contract.manage`

- `ServiceOrdersService.assertManage` aceita **ou** `board.manage` do board vinculado **ou**
  `contract.manage` do workspace dono do contrato — mesmo padrão de orçamento board×portfólio do
  Prompt 12 (editar o orçamento de um board exige `board.manage`; o de um programa/portfólio inteiro
  exige `portfolio.manage`). Aqui o motivo é o inverso: a mesma OS é administrável tanto por quem gerencia
  o board operacional (um PM que não necessariamente administra o contrato todo) quanto por quem
  administra o contrato (que pode não ter acesso de board.manage em todo board do workspace). Em
  ambos os casos, a checagem confirma depois que o módulo `contracts` está ativo no workspace do
  contrato (`assertModuleOnly`), nunca pula essa verificação pelo caminho `board.manage`.
- Medição e fatura usam diretamente `contract.read`/`contract.manage`/`contract.measure` do workspace
  do contrato — não têm o equivalente de "board" (medição e fatura são sempre do contrato inteiro, não
  de uma OS/board específico).

### Vínculo Código Edital × linha da OS: funcionalidade dedicada, não um tipo de coluna genérico

- O projeto não tem (e esta entrega não introduz) um tipo de coluna genérico "lookup"/relacionamento
  entre boards. O vínculo entre uma linha de OS e um item do Catálogo de Serviços é modelado como uma
  entidade relacional própria (`service_order_items.catalogItemId` → `service_catalog_items`), com
  auto-preenchimento de `ustUnit` a partir do `defaultUst` do catálogo e override manual auditado
  (`ustOverrideReason`, obrigatório quando o valor informado diverge do padrão —
  `ServiceOrderItemsService.resolveUstUnit`, validação na aplicação porque depende de comparar contra
  o catálogo, não um `check` de banco simples). `ustTotal` nunca é editável diretamente — sempre
  `computeServiceOrderItemUst(quantity, ustUnit)` — e o total da OS é sempre a soma das linhas
  (`recomputeTotal`), nunca um campo digitado.

### Colunas `service_order.*` vinculadas a item: somente leitura em filtro/ordenação

- `COLUMN_BINDINGS` (`packages/shared/src/columns/registry.ts`) ganhou sete bindings novos
  (`service_order.number`/`.sei_process`/`.requested_at`/`.issued_at`/`.total_ust`/
  `.catalog_codes`/`.billed_at`). A exibição é resolvida em lote por página
  (`ItemsRepository.serviceOrderSummaries`, só quando o board tem alguma coluna com esse binding — a
  mesma economia de evitar join à toa que os bindings `item.*` já tinham), e aparece no DTO do item
  (`toItemDto`) e no CSV/Excel exportado.
- **Decisão deliberada de escopo**: `ItemQueryBuilder.bindingField`
  (`apps/api/src/modules/work/infrastructure/item-query.ts`) só resolve bindings que começam com
  `item.` — um binding `service_order.*` passado a um filtro ou a uma ordenação cai em `null` e é
  ignorado pela compilação da consulta. Dar suporte completo a filtrar/ordenar por um campo que vem de
  um join com `service_orders`/`service_order_items` (em vez de uma coluna nativa do próprio item)
  exigiria estender o compilador de consulta da Tabela para joins externos ao item — fora do escopo
  deste prompt; documentado como limitação conhecida, não escondido atrás de uma coluna que parece
  filtrável mas silenciosamente não filtra.

### Medição mensal agrega por contrato/período, não por OS individual

- `measurements.serviceOrderId` existe no schema (FK opcional) mas **não é usado** por
  `MeasurementsService.generate`: toda medição consolida **todas** as OS do contrato em
  `CONSUMING_ORDER_STATUSES` cuja `acceptedAt` cai no período informado
  (`reconcileMeasurement`, `packages/shared/src/contracts.ts`) — é esse somatório por construção que
  cumpre o critério de aceite "o relatório de medição mensal confere com a soma dos itens", sem
  depender de o operador conferir a conta manualmente. Medir uma única OS isoladamente (preenchendo
  `serviceOrderId`) não é um fluxo suportado nesta entrega; o campo fica reservado para uma extensão
  futura do modelo, caso uma consultoria precise medir por OS em vez de por mês cheio.

### Alertas diários via função SQL de superfície mínima + avaliação em TypeScript

- `app.contract_alert_candidates()` (migração `0023`, `SECURITY DEFINER`) devolve só
  `tenant_id`/`contract_id` dos contratos `active` — mesmo padrão de `app.sla_tracker_alerts()`
  (ADR 0051) e `app.portfolio_health_candidates()` (ADR 0053), necessário porque o papel da aplicação
  não enxerga contratos de outros tenants sob RLS. A avaliação de fato (saldo baixo, vigência,
  OS paradas) roda em TypeScript no worker
  (`apps/worker/src/processors/contracts.ts#createContractAlertsDaily`) com o mesmo motor testado do
  pacote compartilhado (`evaluateLowBalance`/`evaluateExpiring`/`evaluateStalledOrder`) — a função SQL
  só filtra "quais contratos olhar hoje", nunca calcula um limiar de negócio em SQL.
- Notifica (`notification.created` + e-mail) o `managerId` do contrato quando existir; um contrato sem
  gestor definido não gera notificação alguma (os alertas continuam visíveis na tela do contrato, só
  não empurram nada a ninguém). Diferente de `risk_assigned`/`issue_assigned` (ADR 0053), que ao menos
  notificam na criação da atribuição, **não existe nenhuma notificação quando `managerId` é definido
  ou trocado** — o gestor só é avisado pelo job diário, se e quando houver um alerta ativo. Lacuna
  documentada, não escondida.

## Alternativas consideradas

- **Coluna de saldo armazenada em `contracts`, recalculada por trigger/worker a cada mudança de OS**:
  rejeitada pelo mesmo motivo do rollup de portfólio — uma coluna assim pode ficar desatualizada entre
  o evento e o recálculo, e duplica a fonte da verdade (as OS). Calcular ao vivo é mais simples e
  elimina a classe inteira de bug "saldo divergente do que as OS realmente somam".
- **Tipo de coluna genérico `lookup` para o vínculo Código Edital × linha da OS**: rejeitada por ser um
  recurso muito maior que o necessário aqui (relacionamento arbitrário entre boards, com todas as
  implicações de permissão/filtro/indexação) para resolver um caso específico que já tem um modelo
  relacional direto e mais simples.
- **Medição por OS individual desde já** (usando `measurements.serviceOrderId`): adiada — o critério
  de aceite do prompt fala de "relatório de medição mensal", não de medição por item; manter o campo
  no schema sem usá-lo agora custa pouco e preserva a opção.

## Consequências

- Saldo de UST e reconciliação de medição são ambos **verdades por construção** (nunca digitados ou
  cacheados), o que simplifica a UI (nenhum botão "recalcular") e elimina uma classe de bug de
  sincronização — ao custo de reler/somar as OS do contrato a cada requisição (aceitável no volume
  esperado de OS por contrato; sem paginação dedicada nesta entrega).
- Filtrar/ordenar a Tabela por um campo de OS (`service_order.*`) não é possível nesta entrega — só
  exibição. Uma consultoria que precise disso hoje depende de abrir a tela do contrato/OS em vez da
  Tabela.
- Medir uma OS isoladamente não é suportado — só o mês/contrato inteiro.
- Trocar o gestor de um contrato não notifica ninguém; só o job diário de alertas avisa o gestor atual,
  e só quando há algo a alertar.
- UST não entra no rollup de portfólio (ADR 0053 ainda soma `0`) — ligar os dois módulos fica para um
  prompt futuro.
