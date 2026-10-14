# ADR 0003 — Backend como monólito modular (NestJS) com Clean Architecture/DDD

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
O domínio tem ~16 bounded contexts (ver `architecture.md` §1.5) com muitas operações que precisam ser atômicas entre contextos (alterar item + auditoria + outbox + projeção de índice). O time é pequeno no início.

## Decisão
- **Monólito modular** em NestJS: um módulo Nest por bounded context em `apps/api/src/modules/<context>`.
- Camadas por módulo: `domain` (puro, sem framework), `application` (casos de uso, portas), `infrastructure` (Drizzle, Redis, S3…), `presentation` (REST/GraphQL).
- Regra de dependência: camadas internas não importam externas; módulos se comunicam pela API de `application` ou por **eventos de domínio** (in-process + outbox). Fronteiras verificadas por lint (`eslint-plugin-boundaries`) e testes de arquitetura.
- Processos separados apenas por **perfil de escala**, não por domínio: `apps/realtime` (conexões) e `apps/worker` (filas). Ambos reutilizam módulos de `application`/`infrastructure` via pacotes/bibliotecas compartilhadas.
- Extração futura de um contexto para serviço próprio é possível porque os contratos já são eventos + APIs explícitas.

## Alternativas consideradas
- **Microsserviços desde o início**: transações distribuídas (sagas) para operações simples, custo operacional alto, latência extra no caminho crítico do realtime.
- **Monólito em camadas sem módulos**: acoplamento cresce rápido; difícil extrair depois.

## Consequências
- Uma única base de dados com transações ACID locais.
- Disciplina de fronteiras exigida em code review e lint.
