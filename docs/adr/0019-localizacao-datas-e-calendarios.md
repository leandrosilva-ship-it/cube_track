# ADR 0019 — Localização, datas, dinheiro e calendários de trabalho

- **Status:** Aceita
- **Data:** 2026-10-14
- **Prompt:** 1

## Contexto
pt-BR é o idioma padrão; o produto suporta en e es. Prazos contratuais dependem de dias úteis com feriados nacionais, estaduais e municipais; valores financeiros e UST não toleram erro de arredondamento.

## Decisão
- Idiomas `pt-BR` (padrão), `en`, `es` via `packages/i18n`; preferência por usuário com fallback para o tenant.
- **Instantes** em `timestamptz` (UTC); **datas de negócio** (prazo, término planejado/realizado, faturamento) em `date` sem fuso — evitam o clássico "prazo mudou de dia" por fuso.
- Fuso por tenant (padrão `America/Sao_Paulo`) e por usuário para exibição e automações agendadas.
- **Dinheiro e UST** como `numeric(18,4)` no banco e string decimal na API; aritmética com biblioteca decimal (`decimal.js`) — nunca `number` de ponto flutuante.
- **Calendários de trabalho** (`work_calendars`): dias úteis, jornada, feriados nacionais (catálogo global, inclui móveis como Carnaval e Corpus Christi), estaduais e municipais por calendário, exceções; usados por Gantt, SLA, capacity e prazos contratuais.
- Formatos: `dd/MM/yyyy`, separador decimal vírgula, `R$`, máscaras de CPF/CNPJ/telefone e número de processo SEI.

## Alternativas consideradas
- Datas como `timestamptz` à meia-noite: geram erros de fuso.
- Feriados via API externa: dependência de disponibilidade; preferimos catálogo versionado com atualização anual.

## Consequências
- Biblioteca de cálculo de dias úteis compartilhada (`packages/shared/src/dates`) com testes extensivos.
