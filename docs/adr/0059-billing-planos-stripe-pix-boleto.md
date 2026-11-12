# ADR 0059 — Billing: planos Free/Pro/Business/Enterprise, Stripe e Pix/boleto

- **Status:** Aceita
- **Data:** 2026-11-12
- **Prompt:** 16 (Track C — billing; segurança, performance/carga e infraestrutura/deploy são ADRs
  irmãs do mesmo prompt: 0057/0058)

## Contexto

O Prompt 16 pede billing SaaS completo: planos Free/Pro/Business/Enterprise, Stripe para cartão e
Pix/boleto para o mercado brasileiro, e a aplicação real de pelo menos um limite de plano (vagas)
num fluxo existente. Uma sessão anterior desta mesma frente já entregou e commitou a fundação
(catálogo de planos em `packages/shared/src/billing.ts`, verificação de assinatura do webhook em
`packages/shared/src/billing-webhook.ts`, tabelas `subscriptions`/`payment_records` com RLS em
`packages/db/src/schema/billing.ts`/migração `0038`, `tenants.plan` como enum) antes de atingir o
limite de requisições. Esta ADR cobre as decisões do módulo de API que faltava
(`apps/api/src/modules/billing/`), construído sobre essa fundação sem refazê-la.

## Decisões

### Segredo do Stripe é da PLATAFORMA, nunca BYOK por tenant

Único entre todas as integrações do projeto (Slack, Teams, Google/Microsoft, GitHub — todas BYOK,
chave cifrada por tenant): `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` são configuração da API
(`AppConfig`), porque CUBE TRACK é quem cobra o tenant, não o contrário — já decidido pela sessão
anterior (comentário em `packages/db/src/schema/billing.ts`) e mantido aqui.

### `tenant.billing` (permissão já existente) em vez de um novo conceito de operador de plataforma

O requisito pedia "endpoints admin-only para ver/sobrescrever o plano de um tenant". O projeto não
tem — e esta ADR não cria — um conceito de operador de PLATAFORMA (staff da CUBE TRACK agindo sobre
qualquer tenant). `isTenantSuperuser` (`apps/api/src/modules/access/domain/effective-access.ts`) é
tenant-scoped (owner/admin da PRÓPRIA organização), não cross-tenant. Decisão: reaproveitar
`tenant.billing`, a permissão de tenant já cadastrada em `packages/shared/src/permissions.ts` e já
concedida só ao papel `owner` (não `admin`) desde o provisionamento (`packages/db/src/provisioning.ts`,
nunca alterado aqui). `POST /v1/billing/plan/override` é autosserviço do próprio `owner`, não uma
tela de suporte cross-tenant — essa lacuna fica documentada (`docs/billing.md` §3), não fingida como
resolvida. Alternativa descartada: inventar um papel `platform_staff`/flag em `users` sem um pedido
de produto concreto para isso — contrariaria "em caso de ambiguidade, escolher a opção mais alinhada
às melhores práticas" (CLAUDE.md §6.6: não inventar superfície nova sem necessidade).

### `PaymentMethodAdapter`: um adaptador por família de método, escolhido em runtime

`packages/shared/src/billing.ts` não define uma forma de adaptador de pagamento (é puro/síncrono;
um adaptador de checkout tem I/O) — definida em `apps/api/src/modules/billing/application/ports.ts`.
Forma escolhida: `supports(method): boolean` + `createCheckout(method, context)`, com
`BillingService` escolhendo o primeiro adaptador registrado que atende o método pedido, em vez de um
`Record<PaymentMethod, Adapter>` fixo — permite que `PixBoletoAdapter` sirva DOIS métodos (`pix` e
`boleto`) com uma implementação só (mesmo stub, mesma lacuna documentada), sem duplicar classe.

### Checkout por cartão: `StripeClient` como porta, SDK real por trás — sem chave de teste disponível

`StripeClient` (porta) + `StripeSdkClient` (implementação real com `stripe@23.1.0`,
`checkout.sessions.create` com `price_data` inline — sem precisar pré-cadastrar um `Price` por plano
no painel do Stripe). **Nenhuma chamada real foi exercitada nesta sessão**: o sandbox não tinha uma
chave de teste do Stripe disponível (confirmado antes de escrever o adaptador, não depois). A porta
existe precisamente para isso: a lógica própria (`BillingService`, `StripeAdapter`) é testável contra
um fake determinístico da porta, sem precisar da rede ou de credenciais — decisão alinhada ao
CLAUDE.md §6.6 ("documentar a lacuna e seguir", nunca fingir uma integração testada que não foi).
Verificação de assinatura do webhook reaproveita `verifyStripeSignature` (já commitado, mesmo esquema
real do Stripe) em vez do helper de webhook do próprio SDK — evita puxar a dependência de webhook do
SDK para uma função que já existia e já tinha teste próprio.

### Pix/boleto: adaptador stub que ativa o plano na hora do checkout (não fica "pendente" para sempre)

Sem nenhum PSP Pix/boleto real integrado (lacuna deliberada, documentada em `docs/billing.md` §5),
não existe um webhook assíncrono real que confirmaria o pagamento depois. Duas opções: (a) o
checkout cria uma cobrança `pending` que nunca é confirmada (mais "realista" sobre a ausência de
PSP, mas deixa o método permanentemente inutilizável), ou (b) o checkout ativa o plano e marca a
cobrança como `paid` na mesma requisição, documentando que é uma simplificação do stub. Escolhida
(b): é o próprio `owner` do tenant escolhendo pagar o PRÓPRIO plano (ator confiável, sem risco de
terceiro movimentando dinheiro de outra pessoa) — simular a confirmação imediata deixa Pix/boleto de
fato utilizáveis nesta entrega, com a lacuna (nenhum PSP real, o "pagamento" não é verificado de
verdade) escrita às claras no comentário do adaptador e em `docs/billing.md`, nunca escondida atrás
de um fluxo que parece real mas não é.

### Resolução de tenant no webhook: metadata do evento primeiro, função SQL como fallback

A sessão anterior já havia preparado `app.resolve_subscription_by_stripe_id` (migração `0038`,
SECURITY DEFINER, mesmo padrão de `app.resolve_item_for_reply`) antecipando esta necessidade. Decisão
desta ADR: usar `metadata.tenantId` do PRÓPRIO evento do Stripe como caminho PRIMÁRIO (setado na
criação do Checkout Session, ecoado de volta pelo Stripe em todo evento relacionado — round-trip,
sem round-trip ao banco) e cair para a função SQL só quando a metadata está ausente (eventos de
fatura, que não carregam a metadata customizada da assinatura). Mais rápido no caminho comum
(checkout/assinatura, que é a maioria dos eventos) e ainda correto no caminho de fatura.

### Limite de vagas: guarda pura + `COUNT` em tempo real, nunca um contador

`assertSeatLimit` (domain) é puro — mesmo padrão de `assert-module-enabled.ts` — e
`SeatLimitService.assertCanAddMembers` (application, exportado do `BillingModule`) faz `COUNT` de
`memberships` ativos + `invitations` pendentes dentro da transação corrente do convite, nunca um
contador em cache/coluna (que divergiria da realidade a cada exclusão/expiração sem um hook
dedicado). Chamado de `InvitationService.create` (identidade) — único ponto de acoplamento entre os
dois módulos, pela API pública do módulo de billing, como o CLAUDE.md §5 pede ("um módulo só acessa
outro pela sua API pública"). Verificado SÓ para `kind: 'member'` (convidados externos não ocupam
vaga, já decidido pelo catálogo de planos da sessão anterior) e SÓ depois de confirmar que o convite
vai de fato criar uma vaga nova (depois do check de "já é membro" — reconvite não deveria contar).

### `payment_records`: idempotência pelo índice único PARCIAL exige `targetWhere`

`payment_records_tenant_provider_ref_key` (já migrado, `0038`) é um índice único PARCIAL
(`where provider_reference_id is not null` — cobranças sem id de provedor, se um dia existirem,
nunca colidem entre si). `INSERT ... ON CONFLICT (tenant_id, provider_reference_id) DO UPDATE` sem
repetir esse mesmo predicado como `targetWhere` falha em runtime ("no unique or exclusion constraint
matching the ON CONFLICT specification") — descoberto rodando os testes de integração desta entrega
contra o Postgres real (não antecipado só lendo o schema). Corrigido adicionando `targetWhere` igual
ao `where` do índice; documentado aqui para a próxima pessoa que mexer num índice único parcial com
upsert não ser surpreendida pelo mesmo erro.

### `billing-reconciliation-daily` (worker): só aviso, nunca fonte de verdade

A sessão anterior já havia deixado `app.billing_reconciliation_candidates()` pronta (migração
`0038`) e o nome da rotina (`billing-reconciliation-daily`) citado em comentário, antecipando este
job. Implementado como rede de segurança de MONITORAMENTO (e-mail de dunning ao(s) `owner`/`admin`
do tenant) — nunca muda `subscriptions.status`/`tenants.plan` sozinho. A fonte de verdade do estado
da assinatura é sempre o webhook do Stripe (ou, para Pix/boleto, o próprio checkout). `MAINTENANCE_JOBS`
(`packages/shared/src/jobs.ts`) e `MAINTENANCE_SCHEDULE` (`apps/worker/src/processors/maintenance.ts`)
atualizados na MESMA entrega — um agente anterior deste projeto já havia quebrado o typecheck uma vez
esquecendo a metade do agendamento, não repetido aqui.

## Lacunas conhecidas (ADRs futuras ou follow-up, não cobertas aqui)

- Nenhuma chamada real ao Stripe foi exercitada (sem chave de teste neste sandbox) — ver
  `docs/billing.md` §5.
- Pix/boleto são um stub deliberado, sem PSP real integrado — ver `docs/billing.md` §5.
- Sem conceito de operador de plataforma cross-tenant — ver `docs/billing.md` §3.
- Checkout por cartão não faz troca de plano "no lugar" de uma assinatura Stripe já ativa (exige um
  novo Checkout Session) — ver `docs/billing.md` §5.
- Seat limit não cobre provisionamento via SCIM — ver `docs/billing.md` §6.
