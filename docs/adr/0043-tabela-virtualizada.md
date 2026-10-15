# ADR 0043 — Tabela virtualizada com TanStack Virtual e modelo de linhas próprio

- **Status:** Aceita
- **Data:** 2026-10-15
- **Prompt:** 5

## Contexto

A Tabela precisa rolar 50 mil itens a pelo menos 50 fps, com grupos em até 3 níveis, subitens, linhas de "adicionar" e rodapés com agregados, colunas fixadas e edição no estilo planilha, tudo acessível por teclado.

## Decisão

- **TanStack Virtual** para linhas e colunas (2D), **sem TanStack Table**: as linhas são heterogêneas (cabeçalho de grupo, item, subitem, adicionar, rodapé). Um modelo puro (`features/table/model.ts`) gera as linhas a partir dos itens carregados, do agrupamento e dos estados recolhido/expandido.
- **Colunas fixadas** (nome sempre; outras pela view) ficam num contêiner `sticky`; as roláveis são posicionadas pela janela virtual horizontal. Larguras, ordem, fixação e ocultas ficam no estado da view (local até o Prompt 6, que as salva na view); quem tem `column.manage` também grava largura e ordem como padrão do board.
- **Dados:** páginas de 500 itens com indicadores (subitens, anexos, atualizações não lidas), carregadas em sequência até o fim; filtros E/OU, busca e ordenação múltipla (até 3 termos) no servidor; agrupamento e agregados no cliente sobre o que já chegou.
- **Acessibilidade:** padrão ARIA `grid` com `aria-activedescendant` (o foco fica no contêiner, a célula ativa é indicada), navegação por setas, Tab, Home/End, PageUp/PageDown, Enter/F2 para editar, Esc, Delete, Espaço, Shift+setas para seleção retangular, Ctrl+C/X/V (TSV), Ctrl+D e Ctrl+Z.
- **Edição:** um editor por tipo (`editors.tsx`), inline para textuais e em popover para listas/datas; os mesmos editores servem a formulários (obrigatórios, valor padrão, edição em massa).
- **Tempo real:** eventos aplicam patches no cache do Query (ADR 0033); células alteradas por outra pessoa recebem destaque por 2,5 s (sem animação com `prefers-reduced-motion`).
- **Performance:** linhas memoizadas por referência do item, `contain` CSS em linhas, células e contêiner, cabeçalho memoizado, checkbox nativo nas linhas, tradutor único no contexto das células, overscan de 6 linhas.

## Critério medido

E2E `50 mil itens` (Chromium headless, renderização por software, 1440×900, rolagem de 100 px por quadro ≈ 6.000 px/s, após 1 s de aquecimento): **mediana 59,9 fps, média 56,3 fps, 34 linhas no DOM**. O critério usa a mediana dos quadros (robusta a pausas de coleta de lixo logo após carregar 50 mil itens); a média também fica acima de 50.

## Consequências

- Agregados de rodapé e agrupamento por colunas são calculados no cliente; para boards acima de ~100 mil itens, agregações no servidor (GraphQL de leitura, ADR 0009) entram no Prompt 9.
- O carregamento completo de 50 mil itens leva ~17 s neste ambiente (100 páginas); a primeira página aparece imediatamente.
