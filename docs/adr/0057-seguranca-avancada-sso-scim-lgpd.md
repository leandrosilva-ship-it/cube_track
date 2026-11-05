# ADR 0057 — Segurança avançada: SSO SAML 2.0, SCIM, políticas de senha/sessão/IP, visibilidade de item por órgão, auditoria avançada e LGPD

- **Status:** Aceita
- **Data:** 2026-11-05
- **Prompt:** 16 (Track B — segurança; infraestrutura/deploy e performance/carga são ADRs irmãs do mesmo prompt)

## Contexto

O Prompt 16 fecha o produto para clientes que exigem controles formais de segurança — o caso de
referência (consultoria que atende órgãos públicos) precisa de SSO corporativo, provisionamento
automatizado de usuários, políticas de senha/sessão/rede configuráveis, visibilidade de item por
órgão para convidados externos, trilha de auditoria pesquisável/exportável e os mecanismos de LGPD
(consentimento, portabilidade, exclusão). Esta ADR cobre as decisões de design das partes que cabem
à API/banco; cabeçalhos de segurança e CI (SCA/SAST) estão documentados em `docs/security.md`.

Tabelas novas: `sso_configurations`, `security_policies`, `consent_records`, `data_subject_requests`
(`packages/db/src/schema/security.ts`, RLS na migração `0034`), `password_history` (global, migração
`0035`-`0036`) e a coluna `memberships.org_unit`. Contrato compartilhado em
`packages/shared/src/security.ts`.

## Decisões

### SSO SAML 2.0: biblioteca real (`@node-saml/node-saml`), não uma reimplementação de XML-DSig

A sandbox desta entrega tinha acesso de rede ao registro npm, então a verificação de assinatura
(canonicalização C14N exclusiva, XML-DSig, RSA-SHA256) usa `@node-saml/node-saml` — a mesma biblioteca
usada por Passport-SAML — em vez de reimplementar XML-DSig à mão (desaconselhado pela própria ADR
0057: criptografia e parsing de XML são as duas categorias de bug mais caras para acertar sozinho).
Os testes (`apps/api/test/sso.e2e.test.ts`, `saml-fixtures.ts`) montam e assinam uma asserção SAML de
verdade com um certificado/chave autoassinados (`openssl` + `xml-crypto`, a mesma biblioteca que o
node-saml usa por baixo) — nunca mockam `validatePostResponseAsync`. Isso prova que a verificação de
assinatura funciona de ponta a ponta contra o código de produção, inclusive rejeitando uma asserção
adulterada depois de assinada.

### Um IdP por TENANT, resolvido por slug na URL — não um IdP único da plataforma

`sso_configurations` é `tenant_id` + índice único — um SAML SP por organização, com `entityId`/ACS
calculados como `${API_URL}/v1/sso/:tenantSlug/metadata` e `.../acs`. As rotas `GET .../metadata`,
`GET .../login` e `POST .../acs` são públicas (precedem a sessão) e resolvidas via
`TenantResolver.resolve(tenantSlug)` — a mesma função SECURITY DEFINER (`app.resolve_tenant`) já usada
pelo subdomínio/header, sem nova superfície de resolução de tenant.

### `validateInResponseTo: 'never'` e o SP não assina suas próprias requisições

Duas simplificações deliberadas, documentadas para quem for operar isto depois:

1. **Sem cache persistente de `AuthnRequest`** entre instâncias da API (a API roda em múltiplas
   réplicas sem um cache compartilhado dedicado a isso) — `validateInResponseTo: 'never'` aceita tanto
   IdP-initiated quanto SP-initiated sem a proteção extra de replay que o campo `InResponseTo`
   daria. A proteção contra replay que SOBRA é o `maxAssertionAgeMs`/`acceptedClockSkewMs` padrão da
   biblioteca (a asserção expira) — suficiente para o caso de uso (login), não para um protocolo de
   transação financeira.
2. **O SP não assina as próprias `AuthnRequest`s** (sem chave privada própria configurável nesta
   entrega) — aceitável porque a direção que importa para autenticação é IdP → SP (a asserção
   VOLTANDO assinada), que continua obrigatória (`wantAssertionsSigned: true`).

Lacuna conhecida, documentada em `docs/security.md`: um SLO (Single Logout) de verdade e assinatura de
AuthnRequest ficam para uma iteração futura se um cliente exigir.

### Provisionamento (SAML e SCIM) reaproveita a MESMA rotina — não duas

`AuthService.provisionExternalMember` (identidade) é o único lugar que cria uma `membership` fora do
fluxo normal de convite — usado tanto pelo primeiro login SAML (`completeSaml`, quando
`provisionOnFirstLogin` está habilitado) quanto pelo `POST /scim/v2/Users`. Fail-safe: sem
`provisionOnFirstLogin` E sem conta/membership existente, o SAML nega o acesso (`no_account`) — nunca
provisiona por omissão.

### Visibilidade de item por órgão (`guestItemVisibility: 'org'`) — um comparador único

Descrita em detalhe nos comentários de `apps/api/src/modules/access/domain/effective-access.ts` e
`apps/api/src/modules/access/infrastructure/org-match.ts`. Decisão central: fail-safe SEMPRE cai em
`'assigned'` (o escopo mais restrito já existente), nunca em `'all'`, quando a configuração está
incompleta (coluna excluída depois de configurada, convidado sem `orgUnit`, tipo de coluna não
suportado). O comparador de "item pertence ao órgão X" é uma função só (`orgUnitMatchCondition`),
usada tanto pela listagem em massa (`item-query.ts`) quanto pela checagem de item isolado
(`AccessRepository.itemMatchesOrgUnit`) — nunca duas implementações divergentes.

### SCIM: escopo de token reaproveitado, nunca um segundo sistema de autenticação

`scim:manage` é um `ApiScope` comum (`@cube-track/shared/api-access`), mapeado para
`members.invite`/`members.manage` no teto de escopo (`api-scope-map.ts`) — um token SCIM é um token de
API pessoal como outro qualquer, só que com esse escopo a mais, e só funciona se o USUÁRIO dono do
token também tiver essas permissões via RBAC normal (a mesma filosofia de teto da ADR 0056). SCIM
Groups é somente leitura (espelha `teams`): CRUD de times já estava fora de escopo desde o Prompt 11 —
provisionar grupo por SCIM herdaria a mesma limitação, então a opção foi não fingir suporte a escrita
em vez de inventar CRUD de time só para isto.

### Política de senha/sessão/IP: lida sob RLS normal, nunca pela conexão `app_auth`

`security_policies` é uma tabela de negócio igual a qualquer outra (RLS, `app_rw`/`TransactionRunner`)
— só que `AuthService`/`SessionService` (que normalmente só enxergam tabelas GLOBAIS via `app_auth`)
precisam lê-la ANTES de uma sessão existir. Resolvido abrindo uma transação dedicada
(`TransactionRunner.run({tenantId, userId}, ...)`) exatamente como `signup()` já fazia para
provisionar um tenant novo — nenhum mecanismo novo, só o mesmo padrão aplicado em mais um lugar.

- **Senha**: a política do tenant SOMA com a política de base (não configurável: tamanho mínimo
  absoluto, bloqueio de senhas comuns, proibição de conter o e-mail) — a configurável nunca afrouxa a
  de base. Histórico em tabela GLOBAL nova (`password_history`, como `users.password_hash`): um
  usuário pode pertencer a vários tenants com políticas diferentes, mas só tem UMA senha — o tenant do
  login/troca corrente decide qual política aplicar NAQUELE momento. Login com senha expirada
  (`maxAgeDays`) nunca bloqueia sem saída: devolve 403 `password_expired`, caminho normal é "esqueci
  minha senha" (fluxo já existente, reaproveitado).
- **Sessão**: `maxConcurrentSessions` expulsa a sessão ATIVA mais antiga ao exceder (nunca a recém-
  emitida) — eviction, não rejeição do novo login (mais previsível para o usuário). Timeout de
  inatividade e vida útil absoluta são avaliados no REFRESH (não a cada requisição com o access token,
  que não toca o banco) — a vida útil absoluta conta da criação da FAMÍLIA de rotação, não da última
  renovação, senão nunca expiraria de verdade.
- **IP/domínio**: fail-safe — habilitada sem NENHUMA das duas listas preenchida bloqueia tudo
  (`no_rules_configured`), nunca libera por omissão. Com as duas preenchidas, exige IP E domínio (E
  lógico) — a combinação mais restritiva faz sentido para o caso de referência (rede corporativa E
  domínio institucional). Parsing de CIDR IPv4/IPv6 em JavaScript puro (sem `node:net`) porque este
  módulo entra no barrel principal de `@cube-track/shared`, e qualquer módulo nativo ali quebra o
  bundle do cliente Next.js (mesmo motivo documentado para `node:crypto` em `crypto.ts`).
- **Lacuna documentada**: o allowlist de IP/domínio é aplicado no LOGIN, não a cada requisição
  autenticada subsequente — o `AuthGuard` roda ANTES da transação RLS da requisição (ordem do
  pipeline: contexto → tenant → `AuthGuard` → `RateLimitGuard` → interceptors), então checá-lo ali
  exigiria abrir uma transação ad-hoc em TODA requisição autenticada, um custo de desempenho real para
  um ganho de segurança marginal (a sessão já nasceu de um login que passou pela allowlist).

### Auditoria avançada: exportação escreve DIRETO na resposta HTTP, nunca materializa tudo

Achado real durante a verificação: uma geradora assíncrona devolvida pelo `AuditService` para o
controller consumir DEPOIS do `return` não funciona — o `TransactionRunner` fecha a transação da
requisição assim que a PROMESSA do método do controller resolve (`TransactionInterceptor`), e por
padrão o NestJS só começa a consumir um `StreamableFile`/stream de resposta DEPOIS que o controller
retorna. Resultado: a exportação sempre voltava vazia (conexão já liberada ao pool). Corrigido fazendo
o PRÓPRIO método de serviço escrever cada linha na resposta HTTP (`@Res()`, escrita manual) e só
retornar quando a última linha foi escrita — a transação fica aberta exatamente pelo tempo necessário,
e o volume de memória usado continua O(1) por linha (nunca um array com o resultado inteiro).

### LGPD: exclusão anonimiza, nunca exclui de verdade — e exportação é parcial, documentada como tal

`AuthService.anonymizeUser` segue o MESMO padrão que já existia para desfazer um cadastro sem
organização (`signup`, caminho de erro) — `users.status = 'anonymized'` (valor já existente no enum),
e-mail/nome substituídos, segredos de MFA limpos, todas as sessões revogadas. Nunca um DELETE de
verdade: `auditLogs`/`outboxEvents`/itens criados pelo usuário mantêm `created_by`/`actor_id` como
referência — a própria trilha de auditoria e a integridade referencial exigem o id continuar
existindo, só o CONTEÚDO identificável é removido.

A exportação de dados pessoais (`GET /v1/me/lgpd/export`) cobre perfil, memberships, consentimentos e
até 1000 entradas de auditoria como ator — e diz explicitamente, no campo `outOfScope` da própria
resposta, o que NÃO cobre (comentários/atualizações de item, itens em que a pessoa é responsável,
apontamentos de horas). Documentado com mais detalhe em `docs/lgpd.md`.

## Consequências

- Positivas: SSO/SCIM reais (não um esqueleto), fail-safe consistente em toda superfície nova (visibilidade por órgão, allowlist de IP, provisionamento SAML), um bug real de concorrência (exportação de auditoria) e um bug real pré-existente (`updateRole` com `.set({})` vazio) encontrados e corrigidos durante a própria verificação deste prompt.
- Negativas/lacunas: sem SLO SAML, sem assinatura de AuthnRequest pelo SP, allowlist de IP só no login (não por requisição), exportação LGPD parcial (módulos listados), SCIM Groups somente leitura.
