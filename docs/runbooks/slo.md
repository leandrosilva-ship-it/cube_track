# SLO — CUBE PROJECT

## Alvo de disponibilidade

**99,9% de disponibilidade mensal** para a API e o web (medido pelo sucesso de
`GET /health/ready` na api, verificado de fora do cluster a cada 1 minuto).

- Orçamento de erro mensal: **≈ 43 minutos e 50 segundos de indisponibilidade** por mês
  (30 dias × 24h × 60min × 0,1% ≈ 43,2 min; usamos 43m50s como valor de referência arredondado
  para um mês de 30,44 dias em média).
- Orçamento de erro semanal (para acompanhamento mais granular): ≈ 10 minutos.

## O que conta como "indisponível" ("down")

Um minuto conta como indisponível quando **qualquer uma** destas condições é verdadeira por mais
de 2 verificações consecutivas (evita contar uma única falha transitória de rede):

1. `GET https://api.<domínio>/health/ready` não responde `200` (ver
   `apps/api/src/core/observability/health.controller.ts`: `status: 'down'` quando PostgreSQL ou
   Redis falham — Meilisearch sozinho só rebaixa para `degraded`, que **não** conta como "down"
   para este SLO, mas é registrado à parte como degradação de busca).
2. `GET https://app.<domínio>/` (web) não responde `200` em até 5s.
3. p95 de latência da API fica acima de **2000 ms** por mais de 5 minutos seguidos (o alvo de
   latência "normal" é 200 ms, ver abaixo — mas só classificamos como indisponibilidade o
   extremo de 10x o alvo, sustentado; entre 200 ms e 2000 ms é degradação de performance, não
   indisponibilidade).

## Alvos de performance (não são o SLO de disponibilidade, mas orientam os alertas)

- **p95 de latência HTTP da API: < 200 ms** (meta do prompt 16). Ver
  `infra/observability/prometheus/alerts.yml` (`CubeTrackApiLatencyP95High`).
- **p95 de propagação de eventos em tempo real: < 300 ms** (ADR 0027 / `docs/realtime-events.md`
  — medido em produção pelo histograma `cube_realtime_propagation_ms`; o teste automatizado mede
  ~64 ms).

## Política de orçamento de erro

- **Orçamento de erro consumido < 50% no mês:** operação normal — nenhuma restrição.
- **Orçamento de erro consumido entre 50% e 100%:** entra em alerta — toda mudança de risco
  (migração destrutiva, mudança de infra, feature com flag ligada por padrão) exige revisão
  explícita de um segundo engenheiro antes do deploy, e releases passam a ir primeiro para
  staging com um período de observação mínimo de 24h antes de produção.
- **Orçamento de erro esgotado (100% consumido) no mês corrente:** **feature freeze** — nenhum
  deploy de funcionalidade nova em produção até o fim do mês corrente (correções de bug e de
  segurança continuam liberadas, sempre com os runbooks de `docs/runbooks/` seguidos). O time
  prioriza, nesse período, causa-raiz dos incidentes do mês e débito técnico de confiabilidade
  (ex.: endurecer um probe, corrigir um índice faltante, aumentar réplicas).
- Todo incidente que consome orçamento de erro gera um post-mortem curto (causa, impacto em
  minutos de orçamento, ação de prevenção) linkado a partir do runbook relevante nesta pasta.

## Como medir hoje vs. o que falta

O cálculo acima é o critério formal; **a infraestrutura de observação externa (uptime check de
fora do cluster, dashboard de orçamento de erro) ainda não está implantada neste repositório** —
`docs/deploy.md` lista isso como uma lacuna real (depende de um Grafana/Prometheus de verdade em
produção, fora deste sandbox). As métricas que alimentariam esse cálculo (latência, erro 5xx,
propagação realtime) já são emitidas pela aplicação (OpenTelemetry/Prometheus) e consumidas pelos
dashboards em `infra/observability/grafana/` e pelas regras em
`infra/observability/prometheus/alerts.yml`.
