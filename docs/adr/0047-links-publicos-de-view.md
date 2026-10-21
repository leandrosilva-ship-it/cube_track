# ADR 0047 — Link público somente leitura de uma view

- **Status:** Aceita
- **Data:** 2026-10-16
- **Prompt:** 6

## Contexto

Clientes convidados e públicos sem conta precisam, às vezes, acompanhar uma view (ex.: o board de OS de um órgão público) sem login — com senha e expiração opcionais, e sem nunca expor colunas sensíveis (valores financeiros, UST). A tabela `share_links` e a função SQL `app.resolve_share_link` (SECURITY DEFINER, sem contexto de tenant) já existiam desde o Prompt 2.

## Decisão

- **Recurso por VIEW** (`resourceType = 'view'`), não por board: o link herda exatamente o que a view já mostra (tipo, colunas visíveis, ordem), sem um conceito paralelo de "board público".
- **Token**: 32 bytes aleatórios (`randomToken`, base64url), só o **hash SHA-256** é gravado (`token_hash`); o valor em claro só volta na resposta de criação/regeneração — nunca mais depois (mesmo padrão dos links de convite). Senha opcional em Argon2id (mesmos parâmetros OWASP da senha de conta), hash genérico movido para `core/crypto` (ADR de Clean Architecture já usado para `secrets.ts`) para não acoplar o módulo de estrutura ao domínio de identidade.
- **Fluxo**: `GET .../info` (se exige senha, sem criar sessão) → `POST .../verify` (senha, se exigida) → sessão JWT própria (`typ: share+jwt`, 1h, ADR distinto do access token) → `GET board` / `GET items` exigem essa sessão num cabeçalho próprio (`X-Share-Session`), nunca em `Authorization` (evita colisão com o guard de autenticação normal).
- **Redação de colunas**: união das colunas ocultas da própria view (`hiddenColumnKeys`) com as do link (`settings.hiddenColumnKeys`) — o gestor do link pode esconder ainda mais colunas do que a view já esconde, nunca menos.
- **Escopo cortado nesta entrega** (documentado, não escondido):
  - Itens públicos: só de topo (sem subitens), até 1.000, ordenados por `(group_id, position)` — sem paginação. Filtros/ordenação/agrupamento da própria view **não** são aplicados na leitura pública (ficam para quando o Kanban/Tabela públicos precisarem disso de verdade); a busca (`allowSearch`) filtra só pelo nome.
  - Sem página pública no `apps/web` ainda — só a API. A tela fica para quando o link for exposto na UI de gerenciamento de views.
- Gerenciar o link (criar, trocar senha/expiração/colunas ocultas, revogar) exige a permissão `board.share` (já existia, concedida ao dono do board).

## Consequências

- Nenhuma migração: tabela, enum e função SQL já existiam; só a API (hash/sessão/leitura redigida) e os schemas de transporte foram adicionados.
- Revogar um link preserva o histórico de acesso (`access_count`, `last_accessed_at`) em vez de apagar a linha — alinhado com auditoria/LGPD.
- Qualquer tentativa de acesso (token errado, expirado, revogado, senha errada) responde com a mesma família de erro (`401 share_link_invalid`), sem distinguir os casos — evita enumerar links válidos por tentativa e erro.
