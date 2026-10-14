# ADR 0017 — Módulos opcionais por workspace (ex.: Contratos/OS/UST)

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
O produto é multissetor; Contratos/OS/UST só faz sentido para alguns clientes. Sprints, Timesheet e Portfólio também podem ser irrelevantes para certos times.

## Decisão
- **Registro de módulos** (`ModuleRegistry`) no backend e frontend: cada módulo declara tipos de coluna próprios (*bound columns*), entidades, permissões, eventos, views, widgets de dashboard, gatilhos/ações de automação e itens de menu.
- Ativação por workspace (`workspaces.enabled_modules`) e limitação por plano do tenant (`tenants.plan`).
- Módulos desativados ficam invisíveis na UI e suas rotas retornam 404; dados existentes são preservados.
- Módulos iniciais: `core` (sempre), `agile` (sprints/backlog), `process` (fases/SLA), `schedule` (Gantt/baselines), `resources` (capacity/timesheet), `portfolio`, `contracts` (OS/UST), `ai`.

## Alternativas consideradas
- **Produtos separados**: duplicação e perda da fonte única de dados.
- **Tudo sempre ativo**: UI poluída para quem não usa.

## Consequências
- Feature flags (OpenFeature) cobrem rollout gradual; módulos cobrem escopo de produto — conceitos distintos.
