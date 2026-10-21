# Índice de ADRs

| #                                                               | Título                                                 | Status                          |
| --------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------- |
| [0001](0001-registro-de-decisoes-de-arquitetura.md)             | Registrar decisões de arquitetura                      | Aceita                          |
| [0002](0002-monorepo-turborepo-pnpm.md)                         | Monorepo com Turborepo + pnpm                          | Aceita                          |
| [0003](0003-monolito-modular-nestjs-clean-architecture.md)      | Monólito modular NestJS com Clean Architecture/DDD     | Aceita                          |
| [0004](0004-multi-tenancy-tenant-id-rls.md)                     | Multi-tenancy com `tenant_id` + RLS                    | Aceita                          |
| [0005](0005-colunas-customizaveis-jsonb-com-projecao-tipada.md) | Colunas customizáveis: JSONB + projeção tipada         | Aceita                          |
| [0006](0006-orm-drizzle.md)                                     | ORM: Drizzle                                           | Aceita                          |
| [0007](0007-tempo-real-socketio-redis-processo-dedicado.md)     | Tempo real: Socket.IO + Redis em `apps/realtime`       | Refinada (0027)                 |
| [0008](0008-resolucao-de-conflitos-lww-por-campo-e-crdt.md)     | Conflitos: LWW por campo + CRDT Yjs                    | Aceita                          |
| [0009](0009-api-rest-openapi-e-graphql-leitura.md)              | API REST (OpenAPI) + GraphQL leitura                   | Aceita                          |
| [0010](0010-identidade-oidc-keycloak-scim.md)                   | Identidade: OIDC/Keycloak + SCIM                       | Parcialmente substituída (0026) |
| [0011](0011-busca-meilisearch.md)                               | Busca global com Meilisearch                           | Aceita                          |
| [0012](0012-processamento-assincrono-bullmq-outbox.md)          | BullMQ + outbox transacional                           | Aceita                          |
| [0013](0013-ordenacao-fractional-indexing.md)                   | Ordenação com fractional indexing                      | Aceita                          |
| [0014](0014-identificadores-uuidv7.md)                          | Identificadores UUIDv7                                 | Aceita                          |
| [0015](0015-auditoria-append-only.md)                           | Auditoria append-only com hash encadeado               | Aceita                          |
| [0016](0016-frontend-estado-e-bibliotecas.md)                   | Frontend: estado e bibliotecas                         | Detalhada (0031, 0033, 0034)    |
| [0017](0017-modulos-opcionais-por-workspace.md)                 | Módulos opcionais por workspace                        | Aceita                          |
| [0018](0018-infraestrutura-e-observabilidade.md)                | Infraestrutura e observabilidade                       | Aceita                          |
| [0019](0019-localizacao-datas-e-calendarios.md)                 | Localização, datas, dinheiro e calendários             | Aceita                          |
| [0020](0020-projecao-tipada-mantida-por-trigger.md)             | Projeção tipada mantida por trigger                    | Aceita                          |
| [0021](0021-auditoria-particionada-com-cabeca-de-cadeia.md)     | Auditoria particionada com cabeça de cadeia            | Aceita                          |
| [0022](0022-id-automatico-com-mascara.md)                       | ID automático com máscara gerado no banco              | Aceita                          |
| [0023](0023-identidade-global-e-catalogos-globais.md)           | Usuários e catálogos globais; funções SECURITY DEFINER | Aceita                          |
| [0024](0024-testes-de-integracao-com-banco-real.md)             | Testes de integração com banco real                    | Aceita                          |
| [0025](0025-pacotes-internos-e-versoes-de-ferramentas.md)       | Pacotes internos e versões de ferramentas              | Aceita                          |
| [0026](0026-autenticacao-nativa-na-api.md)                      | Autenticação nativa na API; SAML/SCIM por portas       | Complementada (0032)            |
| [0027](0027-tempo-real-mesmo-codigo-outbox-como-replay.md)      | Tempo real no código da API; outbox como replay        | Aceita                          |
| [0028](0028-papeis-app-auth-e-app-relay.md)                     | Papéis `app_auth`/`app_relay` com RLS dedicada         | Aceita                          |
| [0029](0029-automacoes-e-recalculo-de-cronograma-no-worker.md)  | Automações e recálculo de cronograma no worker         | Aceita                          |
| [0030](0030-padroes-transversais-da-api.md)                     | Padrões transversais da API e build                    | Aceita                          |
| [0031](0031-frontend-nextjs-webpack-e-i18n.md)                  | Next.js 16 + webpack, next-intl com root params        | Aceita                          |
| [0032](0032-autenticacao-no-frontend.md)                        | Auth no frontend: mesma origem, token em memória       | Aceita                          |
| [0033](0033-cliente-de-dados-e-realtime.md)                     | Cliente de dados e realtime no cache do Query          | Aceita                          |
| [0034](0034-design-system-tokens-tailwind4.md)                  | Design system: tokens, Tailwind 4, Radix, Storybook    | Aceita                          |
| [0035](0035-api-de-estrutura-de-navegacao.md)                   | API de estrutura de navegação                          | Aceita                          |
| [0036](0036-pwa-e-orcamento-de-performance-do-frontend.md)      | PWA e orçamento de performance do frontend             | Aceita                          |
| [0037](0037-motor-de-formulas.md)                               | Motor de fórmulas próprio, decimal e compartilhado     | Aceita                          |
| [0038](0038-colunas-calculadas.md)                              | Colunas calculadas: transação ou worker                | Aceita                          |
| [0039](0039-obrigatoriedade-condicional.md)                     | Obrigatoriedade simples e condicional                  | Aceita                          |
| [0040](0040-templates-de-board-e-privacidade.md)                | Templates de board e privacidade                       | Aceita                          |
| [0041](0041-ciclo-de-vida-dos-itens.md)                         | Arquivar, lixeira de 30 dias, mover e desfazer         | Aceita                          |
| [0042](0042-importacao-e-exportacao.md)                         | Importação e exportação CSV/Excel                      | Aceita                          |
| [0043](0043-tabela-virtualizada.md)                             | Tabela virtualizada (TanStack Virtual)                 | Aceita                          |
| [0044](0044-views-salvas.md)                                    | Views salvas: registro, pessoal/compartilhada, padrão  | Aceita                          |
| [0045](0045-kanban-arrastar-e-soltar-e-limite-de-wip.md)        | Kanban: arrastar-e-soltar reaproveita a escrita do item | Aceita                          |
| [0046](0046-transicoes-de-status.md)                            | Transições controladas na coluna de status             | Aceita                          |
| [0047](0047-links-publicos-de-view.md)                          | Link público somente leitura de uma view               | Aceita                          |
| [0048](0048-painel-do-item.md)                                  | Painel do item: e-mail, menções, aprovações, dependências reaproveitadas | Aceita             |
