# ADR 0015 — Auditoria append-only com encadeamento de hash

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
LGPD e controles ISO 27001 (A.8.15 logging) exigem trilha completa e íntegra. Contratos públicos exigem rastreabilidade de quem alterou prazos, UST e status.

## Decisão
- Tabela **`audit_log`** particionada por mês, gravada **na mesma transação** de cada comando: `actor`, `actorKind`, `tenantId`, `action`, `entity`, `entityId`, `before`/`after` (diff por campo), `ip`, `userAgent`, `requestId`, `occurredAt`.
- **Append-only**: `app_rw` tem apenas `INSERT`/`SELECT`; `UPDATE`/`DELETE` revogados; trigger bloqueia alterações.
- **Hash encadeado** por tenant (`hash = sha256(prev_hash || registro)`) verificado por job diário; exportação periódica para armazenamento WORM (S3 Object Lock).
- Eventos de acesso sensível (exportações, login/logout, mudança de permissão, uso de `platform_admin`) também são auditados.
- **Log de atividade do item** (visível aos usuários) é uma projeção separada, derivada de eventos — pode ser filtrada e anonimizada; a auditoria não.
- Dados pessoais na auditoria são minimizados; anonimização LGPD substitui identificadores por pseudônimos preservando a cadeia.

## Alternativas consideradas
- Triggers genéricos no banco: não capturam contexto de request/ator de forma confiável.
- Auditoria apenas via eventos assíncronos: risco de perda.

## Consequências
- Volume alto: retenção configurável (padrão 5 anos), partições antigas movidas para storage frio.
