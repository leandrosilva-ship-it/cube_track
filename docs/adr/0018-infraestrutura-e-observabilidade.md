# ADR 0018 — Infraestrutura, entrega e observabilidade

- **Status:** Aceita (provedor de nuvem pendente — dúvida D2)
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
Requisitos de disponibilidade 99,9%, residência de dados no Brasil, auditoria ISO 27001 e possibilidade futura de instalação dedicada.

## Decisão
- **Docker** multi-stage por app; **docker-compose** para desenvolvimento (PostgreSQL, PgBouncer, Redis, MinIO, Meilisearch, Keycloak, Mailpit, OTel Collector, Grafana).
- **Kubernetes** via **Helm** (HPA, PDB, NetworkPolicies, probes); serviços gerenciados para PostgreSQL (com PITR e réplica), Redis e S3 na nuvem escolhida (região Brasil).
- **GitHub Actions**: lint, typecheck, testes unitários e de integração (Testcontainers), E2E Playwright, build de imagens, SBOM, CodeQL, auditoria de dependências, Trivy; deploy por ambiente (dev → staging → prod) com migrações controladas (*expand/contract*).
- **OpenTelemetry** (traces, métricas, logs) em todos os apps → Collector → Prometheus/Grafana (+ Tempo/Loki); **Sentry** para erros front e back; logs JSON (pino) com `requestId`, `tenantId`, `userId` (sem PII em métricas).
- SLOs e alertas: latência de API, propagação realtime, profundidade de filas, lag do outbox, erros 5xx.
- Segredos em gerenciador de segredos da nuvem / External Secrets.

## Alternativas consideradas
- **Serverless**: incompatível com WebSockets de longa duração e workers persistentes.
- **PaaS (Render/Fly)**: rápido, mas sem garantia de região Brasil e controles de compliance.

## Consequências
- Detalhamento de pipelines e manifests no Prompt 16; docker-compose de desenvolvimento no Prompt 3.
