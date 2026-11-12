# Billing — planos, checkout, webhook e limites

> Ver também a ADR 0059 (decisões de design), `packages/shared/src/billing.ts` (catálogo de planos,
> fonte única de verdade de preço/limites/módulos) e `packages/shared/src/billing-webhook.ts`
> (verificação de assinatura do webhook do Stripe).

## 1. O que é

Planos Free/Pro/Business/Enterprise, checkout de upgrade (cartão via Stripe real, Pix/boleto via
adaptador stub — lacuna documentada no §5), webhook do Stripe e a aplicação real do limite de vagas
do plano no fluxo de convite. O segredo do Stripe é da **PLATAFORMA** (`STRIPE_SECRET_KEY`), nunca
por tenant (BYOK) — ao contrário de toda outra integração do projeto.

## 2. Catálogo de planos

Fonte única: `PLAN_CATALOG` em `packages/shared/src/billing.ts`, usada pela API (checkout, guardas
de limite) e pelo frontend (tela de planos).

| Plano          | Preço mensal (BRL) | Vagas (membros + convites pendentes) | Boards/workspace | Itens/board | Armazenamento |
| -------------- | ------------------: | ------------------------------------: | ----------------: | -----------: | ------------: |
| **Free**       | 0,00                | 5                                     | 3                 | 200          | 1 GB          |
| **Pro**        | 49,90               | 20                                    | 20                | 5.000        | 20 GB         |
| **Business**   | 149,90              | 100                                   | sem limite        | 50.000       | 200 GB        |
| **Enterprise** | sob consulta         | sem limite                            | sem limite         | sem limite    | sem limite     |

`priceBRL` é sempre uma decimal string (`numeric`), nunca `float` (CLAUDE.md §5). Enterprise é sob
contrato — `priceBRL: '0.00'` no catálogo é um placeholder que a UI de planos nunca cobra
automaticamente (mostra "Fale com vendas").

`PlanDefinition.modules` é hoje **só informativo** (tela de planos, avisos de upgrade) — o controle
real de ativação de módulo opcional continua sendo `workspaces.enabled_modules` (ADR 0017), que o
próprio tenant liga/desliga independentemente do plano contratado. `planIncludesModule` não é
chamado por `assertModuleEnabled`.

## 3. Quem pode administrar o billing do tenant

Toda rota de `/v1/billing/*` (exceto o webhook) exige a permissão de tenant **`tenant.billing`**
(já existente em `packages/shared/src/permissions.ts`, concedida por padrão **só ao papel
`owner`** — `admin` administra membros/auditoria/SSO, mas não billing; ver
`packages/db/src/provisioning.ts`).

**Lacuna deliberada**: este projeto não tem hoje um conceito de "operador de PLATAFORMA" (staff da
CUBE TRACK agindo sobre QUALQUER tenant, fora do próprio). O requisito de "endpoints admin-only
para ver/sobrescrever o plano de um tenant" foi implementado como autosserviço do `owner` do
PRÓPRIO tenant (`POST /v1/billing/plan/override`), reaproveitando a permissão já existente, em vez
de inventar um novo conceito de papel cross-tenant — ver `apps/api/src/modules/access/` (`isTenantSuperuser`
é tenant-scoped: owner/admin da própria organização, não um operador de plataforma). Uma futura ADR
pode introduzir um papel de suporte cross-tenant, se o produto precisar (ex.: telas internas de
CS/suporte), mas isso está fora do escopo desta entrega.

## 4. Endpoints

| Rota                              | Método | Autenticação         | O que faz |
| ---------------------------------- | ------ | --------------------- | --------- |
| `/v1/billing/subscription`         | GET    | `tenant.billing`      | Plano, status, uso corrente (vagas, armazenamento) e limites do plano |
| `/v1/billing/payments`             | GET    | `tenant.billing`      | Histórico de cobranças (mais recente primeiro) |
| `/v1/billing/checkout`             | POST   | `tenant.billing`      | Inicia upgrade: `{ plan, method: 'card'\|'pix'\|'boleto' }` |
| `/v1/billing/cancel`               | POST   | `tenant.billing`      | Cancela a assinatura paga (agenda para o fim do período já pago) |
| `/v1/billing/plan/override`        | POST   | `tenant.billing`      | Override administrativo do plano (sem cobrança — trial/correção) |
| `/v1/billing/stripe/webhook`       | POST   | **pública** (HMAC)    | Recebe eventos do Stripe |

### Checkout

- **Cartão**: `StripeAdapter` chama `stripe.checkout.sessions.create` de verdade (modo assinatura,
  `price_data` inline — sem precisar pré-cadastrar um `Price` por plano no painel do Stripe) e
  devolve `{ method: 'card', kind: 'redirect', redirectUrl, stripeSessionId }`. **A assinatura só é
  ativada pelo webhook** (`checkout.session.completed`) — o checkout em si não grava nada.
- **Pix/boleto**: `PixBoletoAdapter` (stub, §5) devolve o payload falso e **ativa o plano de
  imediato** na mesma requisição (grava `payment_records` com `status: 'paid'`) — não há PSP real
  para confirmar o pagamento depois, então a única forma honesta de o checkout "funcionar de
  verdade" nesta entrega é tratar o clique como pagamento confirmado. Documentado como lacuna, não
  escondido.
- Checkout do plano `free` é rejeitado (400) — Free nunca passa por cobrança; use `cancel` para
  voltar a ele.

### Webhook (`POST /v1/billing/stripe/webhook`)

Sem sessão/Bearer (o Stripe não tem como enviar um). Autenticado por `Stripe-Signature`
(HMAC-SHA256 sobre o corpo bruto, `verifyStripeSignature` — já commitado em
`packages/shared/src/billing-webhook.ts`, mesmo esquema real do Stripe: `t=<timestamp>,v1=<hmac>`,
rejeita timestamps com mais de 5 minutos).

Eventos tratados: `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Outros tipos são
reconhecidos (200, `handled: false`) e ignorados — nunca um erro, para o Stripe não ficar
retentando para sempre um evento que de propósito não tratamos.

**Resolução do tenant** (o webhook não tem contexto de tenant até resolver um):

1. **Primário**: `metadata.tenantId` do próprio evento — setado na criação do Checkout Session
   (`subscription_data.metadata`/`metadata`) e ecoado de volta pelo Stripe em todo evento
   relacionado (round-trip).
2. **Fallback**: `app.resolve_subscription_by_stripe_id(customerId, subscriptionId)` (função SQL
   `SECURITY DEFINER`, já migrada em `0038_billing_rls_and_resolver.sql`) — usada pelos eventos de
   fatura (`invoice.*`), que não carregam a metadata customizada, resolvendo pelos ids do Stripe já
   gravados em `subscriptions` por um evento anterior.

Idempotência: `payment_records` tem `UNIQUE (tenant_id, provider_reference_id)` (índice parcial,
`where provider_reference_id is not null`) — `insertPaymentRecord` faz `INSERT ... ON CONFLICT ...
DO UPDATE` sobre esse índice, então reentregas do mesmo evento do Stripe (garantidas pelo próprio
Stripe, "at-least-once") nunca duplicam uma cobrança.

### Cancelamento

Nunca cancela um período já pago: agenda (`cancelAtPeriodEnd: true`). Cartão chama
`stripe.subscriptions.update(id, { cancel_at_period_end: true })` de verdade; Pix/boleto (sem
assinatura recorrente real) agenda para o fim do período simulado guardado em
`currentPeriodEnd`, ou volta a Free imediatamente se esse período já tiver vencido.

## 5. Lacunas documentadas honestamente

- **Nenhuma chamada real ao Stripe foi exercitada nesta sessão.** Este sandbox não tem uma chave de
  teste do Stripe (`sk_test_...`) disponível. `StripeSdkClient` foi escrito contra as formas
  documentadas do SDK `stripe@23.1.0` (`checkout.sessions.create`,
  `subscriptions.update`) e **testado apenas através da porta `StripeClient`/`PaymentMethodAdapter`**
  (seam injetável) — os testes automatizados (`apps/api/test/billing.e2e.test.ts`) cobrem Pix/boleto
  (caminho real, sem PSP) e o webhook (assinatura HMAC real, sem chamar o Stripe de verdade) de
  ponta a ponta; o caminho de cartão (`checkout.sessions.create` real) não tem teste de integração
  contra a API real do Stripe. Isso é esperado e aceitável para esta entrega — nunca "fingido" como
  testado.
- **Pix/boleto são um adaptador stub, deliberadamente falso.** `PixBoletoAdapter` nunca chama um PSP
  real (não há integração com nenhum banco/Pix Service Provider neste projeto). O payload Pix
  (`FAKE-PIX-COPIA-COLA|...`) e a linha do boleto (`FAKE-BOLETO-...`) são determinísticos (mesmo
  tenant/plano/dia produz o mesmo valor) e claramente marcados como falsos — nunca teriam o formato
  de um QR/código de barras real, de propósito. Como não há PSP real para confirmar o pagamento
  depois, o checkout ativa o plano na hora (ver §4). Uma integração real (ex.: um PSP Pix via Open
  Finance, ou um gateway com suporte a boleto) é trabalho futuro, não coberto aqui.
- **Sem conceito de operador de plataforma cross-tenant** — ver §3.
- **`billing-reconciliation-daily`** (worker, `apps/worker/src/processors/billing.ts`) é só uma
  rede de segurança de monitoramento/dunning (lembrete por e-mail aos `owner`/`admin` do tenant) —
  NUNCA muda `subscriptions.status`/`tenants.plan` sozinha. A fonte de verdade do estado da
  assinatura é sempre o webhook do Stripe (ou, para Pix/boleto, o próprio checkout). Uma assinatura
  que fica `past_due`/com o período vencido sem o webhook de renovação chegar (rede/infra do Stripe
  fora do ar, por exemplo) fica sinalizada para o tenant, mas não é corrigida automaticamente por
  esta rotina — exigiria reconciliar diretamente com a API do Stripe (`subscriptions.retrieve`),
  fora do escopo desta entrega.
- **Checkout por cartão não lida com troca de plano de uma assinatura Stripe já ativa** (upgrade
  Pro → Business sem passar por um novo Checkout Session, ex. `subscriptions.update` com um novo
  item) — hoje, trocar de plano com uma assinatura de cartão já ativa exige um novo checkout
  completo. Simplificação deliberada desta entrega, não uma limitação do Stripe em si.

## 6. Limite de vagas (seat limit)

`maxSeats` do plano corrente (`tenants.plan` — mantido em sincronia com `subscriptions.plan` na
mesma transação, sempre que o plano muda, por `BillingRepository.applyPatch`) contra uma contagem
**em tempo real** (nunca um contador em cache/coluna):

```
vagas em uso = memberships ativos (kind = 'member', deletedAt is null)
             + invitations pendentes (kind = 'member', não aceito/revogado, não expirado)
```

Convidados externos (`kind: 'guest'`) **não** ocupam vaga.

- **Guarda pura**: `assertSeatLimit(plan, currentSeats, additional)`
  (`apps/api/src/modules/billing/domain/seat-limit.ts`) — mesmo padrão de
  `core/modules/assert-module-enabled.ts`: lança `ConflictError` 409 (`seat_limit_exceeded`) sem
  Nest, sem Drizzle, testável isoladamente.
- **Aplicação**: `SeatLimitService.assertCanAddMembers` (aplicação, consulta `COUNT` + lê
  `tenants.plan` dentro da transação corrente) — exportado do `BillingModule` e consumido pelo
  `IdentityModule` (`InvitationService.create`), chamado **depois** de confirmar que o convite vai
  de fato ser criado (depois do papel/recurso validados e de confirmar que não é um re-convite a
  alguém já membro — re-convite não consome vaga nova).
- **Lacuna conhecida**: o provisionamento via SCIM (`apps/api/src/modules/sso/`) não passa por este
  guard — um provedor de identidade corporativo pode, hoje, criar mais membros do que o plano
  permite sem ser barrado. Fora do escopo desta entrega (o requisito pedia o fluxo de convite);
  registrar como follow-up se o produto decidir cobrar vagas via SCIM também.

## 7. Como rodar e testar

```bash
pnpm infra:up && pnpm db:migrate && pnpm db:seed
pnpm --filter @cube-track/api dev
pnpm --filter @cube-track/shared test        # catálogo de planos, verificação de assinatura do webhook
pnpm --filter @cube-track/api test -- billing # unit (seat-limit) + e2e (checkout/cancelamento/override/webhook/limite de vagas)
```

Variáveis (`.env.example`): `STRIPE_SECRET_KEY` (vazia em dev — checkout por cartão fica
indisponível, `NotImplementedError`; Pix/boleto seguem funcionando) e `STRIPE_WEBHOOK_SECRET`
(tem um valor de desenvolvimento padrão).

Manualmente (sem chave real do Stripe): `POST /v1/billing/checkout` com `method: 'pix'` ou
`'boleto'` ativa o plano na hora; `GET /v1/billing/subscription` confirma. Para simular o webhook
sem o Stripe de verdade, assine o corpo com `signStripePayload` (mesma função usada nos testes,
`@cube-track/shared/billing-webhook`) usando o `STRIPE_WEBHOOK_SECRET` do ambiente.
