# LGPD — o que está implementado

> Ver também `docs/security.md` (mapeamento ISO 27001) e a ADR 0057 (decisões de design).

## 1. O que é

Mecanismos de conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018): consentimento,
portabilidade (exportação), eliminação (exclusão/anonimização) e a política de retenção que já existia
desde o Prompt 2 (`data_retention_policies`, `packages/db/src/schema/governance.ts`).

## 2. Consentimento (`consent_records`)

- Tabela append-only: cada decisão (conceder/revogar) é uma linha nova, nunca uma atualização —
  histórico completo preservado (evidência para auditoria regulatória).
- Finalidades cadastradas (`CONSENT_PURPOSES`, `@cube-track/shared/security`): `marketing_email`,
  `product_analytics`, `ai_processing`. Novas finalidades exigem adicionar ao enum/array — decisão
  deliberada de manter um catálogo fechado (evita que qualquer string vire uma "finalidade" sem
  revisão).
- Autosserviço: `POST /v1/me/lgpd/consents` (registrar) e `GET /v1/me/lgpd/consents` (histórico
  próprio). Sem endpoint de leitura administrativa nesta entrega — lacuna conhecida, abaixo.

## 3. Portabilidade — exportação de dados pessoais

`GET /v1/me/lgpd/export` monta, na hora (sem fluxo de aprovação — é o próprio titular pedindo os
próprios dados, sem efeito destrutivo), um JSON com:

- **Perfil**: id, e-mail, nome, locale, data de criação da conta.
- **Memberships**: cada organização a que pertence, papel e tipo (membro/convidado).
- **Consentimentos**: histórico completo (finalidade, decisão, versão da política, data).
- **Auditoria como ator**: até 1.000 entradas mais recentes em que o usuário é o ATOR, no tenant
  corrente (ação, tipo de entidade, id, data). Um relatório sem limite usa
  `GET /v1/audit/entries/export` (`audit.export`, administrativo).

### Lacunas conhecidas (honestas) desta exportação

A própria resposta devolve essas lacunas no campo `outOfScope`, para nunca dar a impressão de
completude que não existe:

- **Comentários/atualizações de item** (`collaboration.updates`/`replies`) criados pelo usuário — não
  incluídos.
- **Itens dos quais o usuário é responsável** (colunas `people`) — não incluídos; a pessoa pode usar a
  busca/filtro normal de um board para encontrar os seus.
- **Apontamentos de horas e registros de capacidade** (`timesheet`, `resources`) — não incluídos.

Cobrir os três exigiria tocar os módulos `work`/`collaboration`/`timesheet` especificamente para esta
entrega — descartado deliberadamente para manter o escopo do Prompt 16 em segurança/identidade, não em
mudanças espalhadas por módulos de produto já estáveis. Próximo passo natural: cada módulo expõe um
`exportForUser(userId)` próprio, agregado aqui.

## 4. Eliminação — solicitação de exclusão (`data_subject_requests`)

Fluxo de status: `requested` → `approved` (ou `rejected`) → `executed`.

1. `POST /v1/me/lgpd/requests` com `{ kind: 'erasure' }` — o próprio titular solicita (autosserviço,
   sem permissão especial).
2. `POST /v1/lgpd/requests/:id/decide` (`lgpd.manage`) — um administrador aprova ou rejeita. Execução
   SÓ é aceita depois de `approved` (um `execute` prematuro devolve 403, nunca silenciosamente ignora
   ou aprova sozinho).
3. `POST /v1/lgpd/requests/:id/execute` (`lgpd.manage`) — aplica a exclusão.

### Por que anonimiza em vez de excluir de verdade

`AuthService.anonymizeUser`: `users.status = 'anonymized'` (valor já existente no enum desde o
Prompt 3), e-mail/nome substituídos por um valor não identificável, segredos de MFA limpos, sessões
revogadas. **Nunca um `DELETE`** — `audit_logs.created_by`/`outbox_events.actor_id`/`items.created_by`
e dezenas de outras colunas `created_by`/`updated_by` em todo o schema referenciam `users.id`:
excluir de verdade quebraria a integridade referencial E apagaria quem fez o quê da trilha de
auditoria, que por lei (e pela própria LGPD, art. 37, dever de prestação de contas) precisa continuar
íntegra. Anonimizar satisfaz "o dado pessoal não existe mais associável à pessoa" sem quebrar nada.

### Exportação é parcial (acima); execução é total para o que anonimiza

A anonimização cobre TODA a identidade (`users`), não um subconjunto — diferente da exportação, que é
deliberadamente parcial. Itens/comentários/apontamentos criados pela pessoa continuam existindo (são
dados da ORGANIZAÇÃO, não só da pessoa), só deixam de ser identificáveis a ela depois que
`created_by` aponta para uma linha `anonymized`.

## 5. Retenção (`data_retention_policies`, já existia desde o Prompt 2)

A única aplicação nova nesta entrega é o job `audit-retention-purge`
(`apps/worker/src/processors/maintenance.ts`, `MAINTENANCE_SCHEDULE`, diário às 3h30 de Brasília):
expurga partições MENSAIS inteiras de `audit_logs` mais antigas que o prazo configurado — ver "Lacuna
de granularidade" abaixo. Sem nenhuma política `entity_type = 'audit_log'` habilitada, nada é
expurgado (mantém tudo — fail-safe, nunca apaga por omissão).

### Lacuna de granularidade (documentada na ADR 0057)

`audit_logs` é append-only por TRIGGER de linha (bloqueia `UPDATE`/`DELETE` incondicionalmente desde o
Prompt 2) — a única forma real de expurgo é `DROP TABLE` de uma partição MENSAL inteira (DDL, não
dispara o trigger de linha). Com partições compartilhadas por todos os tenants mas retenção
configurada POR tenant, o expurgo usa o MAIOR prazo configurado entre os tenants com a política
habilitada — nunca apaga o dado de um tenant antes do prazo que ele configurou, mas um tenant com
retenção bem mais curta que a de outro não tem o expurgo exato por dia (fica preso ao calendário
mensal e ao prazo do tenant mais exigente). Resolver isso de verdade exigiria particionar
`audit_logs` por tenant também (ou por tenant+mês), uma mudança de schema maior que não cabia nesta
entrega.

## 6. Registro de operações de tratamento

Toda leitura/escrita LGPD (consentimento, solicitação, decisão, execução) passa por `@Audited` e
`DomainEvents.recordChange` — aparece em `audit_logs` como qualquer outra operação, pesquisável via
`GET /v1/audit/entries?entityType=consent_record` ou `...=data_subject_request`. Não há um "registro
de operações de tratamento" (ROPA, art. 37) formal e separado nesta entrega — a trilha de auditoria
cumpre o papel na prática, mas um relatório ROPA dedicado (atividades de tratamento, finalidade, base
legal, compartilhamento com terceiros) fica para uma iteração futura.
