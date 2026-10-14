# ADR 0022 — ID automático com máscara gerado no banco

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 2

## Contexto

Clientes precisam de identificadores legíveis e sequenciais (ex.: `2026-0924`), configuráveis por board e, às vezes, reiniciados por ano. A geração precisa ser livre de duplicidade sob concorrência e funcionar para qualquer escritor (API, importador, automação).

## Decisão

- Tipo de coluna **`auto_id`** com `settings = { mask, resetPeriod: never | yearly | monthly, applyToSubitems }`.
- Tokens da máscara: `{YYYY}`, `{YY}`, `{MM}`, `{DD}`, `{SEQ}`, `{SEQ:n}` (exatamente um token de sequência).
- Contadores em `id_sequences (tenant_id, scope = 'column:<id>', period_key)`; incremento atômico via `INSERT … ON CONFLICT DO UPDATE … RETURNING` (`app.next_sequence`).
- Trigger `BEFORE INSERT` em `items` preenche `values[key] = { text, seq }` quando ausente — importações podem informar o ID original.
- A data do período usa o fuso do tenant.
- Implementação espelhada em TypeScript (`formatDisplayId`) para pré-visualização; teste garante equivalência com a função SQL.

## Alternativas consideradas

- **Sequences do PostgreSQL por coluna**: DDL dinâmica e sem reinício por período.
- **Geração na aplicação com `MAX()+1`**: condição de corrida.

## Consequências

- Lacunas são possíveis (transações revertidas consomem números), comportamento aceito e documentado.
- O valor fica em `values` (filtrável/ordenável via projeção `v_num = seq`).
