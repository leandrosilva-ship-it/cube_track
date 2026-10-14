# ADR 0001 — Registrar decisões de arquitetura (ADRs)

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
O CUBE TRACK será construído em 16 prompts sequenciais, por um time (humano + IA) que precisa manter coerência entre entregas. Decisões tomadas sob ambiguidade precisam ficar rastreáveis.

## Decisão
Usar **Architecture Decision Records** no formato MADR simplificado, em `docs/adr/NNNN-titulo-em-kebab-case.md`, numeração sequencial e imutável.

Estrutura obrigatória: Status, Data, Prompt, Contexto, Decisão, Alternativas consideradas, Consequências.

Regras:
- Uma ADR por decisão relevante (afeta mais de um módulo, é cara de reverter ou foi tomada sob ambiguidade).
- ADRs não são editadas após aceitas; mudanças geram nova ADR com status `Substitui ADR NNNN`, e a antiga passa a `Substituída por NNNN`.
- Status possíveis: `Proposta`, `Aceita`, `Substituída`, `Descontinuada`.
- O índice fica em `docs/adr/README.md`.

## Alternativas consideradas
- Wiki externa: separada do código, desatualiza.
- Apenas comentários em PR: não indexável, se perde.

## Consequências
- Todo prompt revisa e, se necessário, cria ADRs (protocolo em `CLAUDE.md`).
- Leitura obrigatória das ADRs antes de iniciar cada prompt.
