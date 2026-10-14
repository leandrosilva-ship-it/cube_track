# CUBE TRACK — Roadmap

Legenda: ✅ concluído · 🟡 aguardando validação · ⏳ pendente · 🔄 em andamento

| # | Prompt | Status | Entregáveis principais | ADRs |
|---|---|---|---|---|
| 1 | Visão do produto e arquitetura | 🟡 Aguardando validação | `CLAUDE.md`, `docs/architecture.md`, ADRs 0001–0019, este roadmap | 0001–0019 |
| 2 | Banco de dados e tabelas | ⏳ | Schema Drizzle completo, migrações, RLS, índices, seeds (caso PMSP), benchmark 50k itens | — |
| 3 | Backend base | ⏳ | Monorepo, NestJS, tenant context, auth OIDC, Policy Engine, outbox, auditoria, docker-compose, realtime gateway | — |
| 4 | Frontend base | ⏳ | Next.js shell, design system, i18n, auth, navegação workspace/pastas, cliente realtime | — |
| 5 | Boards, colunas e Tabela | ⏳ | CRUD de boards/grupos/colunas/itens, ~30 tipos de coluna, Tabela virtualizada, edição inline realtime | — |
| 6 | Kanban e views salvas | ⏳ | Kanban com raias, filtros/ordenação/agrupamento, views salvas e compartilhadas, link público | — |
| 7 | Painel do item | ⏳ | Atualizações com @menções, respostas, reações, arquivos, log de atividade, subitens, Yjs | — |
| 8 | Calendário, Timeline, Gantt e Formulários | ⏳ | Views de tempo, dependências, caminho crítico, baselines, formulários públicos | — |
| 9 | Dashboards | ⏳ | Widgets, agregações, Project Health, exportação | — |
| 10 | Automações, Processos e Notificações | ⏳ | Motor de regras, fases com SLA, workflows, inbox, e-mail | — |
| 11 | Capacity e Timesheet | ⏳ | Alocação, carga por pessoa, apontamento de horas, aprovações | — |
| 12 | Portfólio | ⏳ | Programas, portfólios, scoring, rollups, visão executiva | — |
| 13 | Contratos/OS/UST | ⏳ | Contratos, catálogo, OS, medição UST, faturamento | — |
| 14 | IA | ⏳ | Assistente, resumos, chatbot do board, sugestões | — |
| 15 | API pública, Integrações, Importadores e Templates | ⏳ | API v1, webhooks, SDK, importador Monday/Jira/Trello/CSV, templates | — |
| 16 | Segurança, Performance, Testes e Deploy | ⏳ | Hardening, testes de carga, CI/CD, Helm, observabilidade, runbooks | — |

## Prompt 1 — Resumo

**Feito**
- Arquitetura de alto nível com diagramas Mermaid (componentes, fluxo de escrita, domínio).
- Estratégia de tempo real (rooms, envelope de eventos, otimismo, sequência por board, replay, LWW por campo + Yjs, reconexão, orçamento de latência).
- Estratégia de colunas customizáveis: JSONB + projeção tipada `item_field_index` (comparativo com EAV e tabelas dinâmicas).
- Multi-tenancy: schema compartilhado + `tenant_id` + RLS forçado, `set_config` local à transação, FKs compostas, papéis de banco.
- Estrutura completa do monorepo (inclui `apps/realtime`, justificado na ADR 0007).
- Modelo de domínio preliminar e mapeamento do caso PMSP (Monday → CUBE TRACK).
- 19 ADRs, `CLAUDE.md` com protocolo de trabalho e DoD.

**Pendências / dúvidas** — ver `docs/architecture.md` §7 (D1–D10). Nenhuma bloqueia o Prompt 2; confirmar premissas P2, P3 e P4.

**Como rodar e testar** — não se aplica (entrega documental, sem código de aplicação).

**Próximos passos** — Prompt 2: modelagem física do banco, migrações Drizzle, políticas RLS, testes de isolamento e benchmark de colunas customizadas.
