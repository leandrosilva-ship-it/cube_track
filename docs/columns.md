# Colunas, fórmulas e Tabela

Referência dos tipos de coluna do CUBE TRACK, das fórmulas e do comportamento da view Tabela. A fonte da verdade dos tipos é `packages/shared/src/columns/registry.ts` (schemas Zod de valor e configuração); a das funções de fórmula é `FORMULA_FUNCTIONS` em `packages/shared/src/formula`.

## 1. Tipos de coluna

| Tipo             | Nome na UI         | Valor armazenado (`items.values[chave]`)       | Configurações                                                                                           | Editável                                 |
| ---------------- | ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `text`           | Texto              | `{ text }`                                     | `maxLength`                                                                                             | sim                                      |
| `long_text`      | Texto longo        | `{ text, doc? }` (`doc` = rich text, Prompt 7) | —                                                                                                       | sim                                      |
| `number`         | Número             | `{ n }` decimal string                         | `unit`, `unitPosition`, `decimals`, `aggregate`                                                         | sim                                      |
| `status`         | Status             | `{ labelId }`                                  | rótulos (cor, categoria), `defaultLabelId`                                                              | sim                                      |
| `dropdown`       | Lista suspensa     | `{ optionIds }`                                | opções (cor), `multiple`                                                                                | sim                                      |
| `people`         | Pessoas            | `{ personIds, teamIds }`                       | `maxPeople`                                                                                             | sim                                      |
| `date`           | Data               | `{ d, time? }`                                 | `includeTime`                                                                                           | sim                                      |
| `timeline`       | Período            | `{ from, to }`                                 | —                                                                                                       | sim                                      |
| `week`           | Semana             | `{ from, to }` (segunda a domingo)             | —                                                                                                       | sim                                      |
| `checkbox`       | Caixa de seleção   | `{ checked: true }`                            | —                                                                                                       | sim                                      |
| `rating`         | Avaliação          | `{ n }`                                        | `max` (1–10)                                                                                            | sim                                      |
| `link`           | Link               | `{ url, text? }`                               | —                                                                                                       | sim                                      |
| `email`          | E-mail             | `{ email, text? }`                             | —                                                                                                       | sim                                      |
| `phone`          | Telefone           | `{ phone, country? }`                          | —                                                                                                       | sim                                      |
| `tags`           | Tags               | `{ tags }`                                     | —                                                                                                       | sim                                      |
| `file`           | Arquivos           | `{ attachmentIds }`                            | —                                                                                                       | via painel do item (Prompt 7)            |
| `auto_id`        | ID automático      | `{ text, seq }`                                | `mask` (`{YYYY}`, `{MM}`, `{SEQ:n}`), `resetPeriod`, `applyToSubitems`                                  | não (gerado)                             |
| `board_relation` | Relação com board  | `{ itemIds }`                                  | `boardIds`, `allowMultiple`                                                                             | sim                                      |
| `mirror`         | Espelho            | `{ n \| d \| text, error?, computedAt }`       | `relationColumnKey`, `targetColumnKey`, `aggregate`                                                     | não (calculado)                          |
| `formula`        | Fórmula            | idem                                           | `expression`, formato numérico                                                                          | não (calculado)                          |
| `progress`       | Progresso          | idem (`n` = %)                                 | `mode` (`status_columns`/`subitems`), `sourceColumnKeys`                                                | não (calculado)                          |
| `rollup`         | Rollup             | idem                                           | `source` (`subitems`/`relation`), `relationColumnKey`, `targetColumnKey`, `aggregate`, formato numérico | não (calculado)                          |
| `dependency`     | Dependência        | tabela `item_dependencies`                     | —                                                                                                       | editor próprio (FS/SS/FF/SF + defasagem) |
| `time_tracking`  | Controle de tempo  | `{ n, runningSince? }` (horas)                 | —                                                                                                       | cronômetro (iniciar/parar)               |
| `location`       | Localização        | `{ address, lat?, lng? }`                      | —                                                                                                       | sim                                      |
| `country`        | País               | `{ code }` (ISO 3166)                          | —                                                                                                       | sim                                      |
| `color`          | Cor                | `{ color }` (`#rrggbb`)                        | —                                                                                                       | sim                                      |
| `hour`           | Hora               | `{ time }` (`HH:mm`)                           | —                                                                                                       | sim                                      |
| `vote`           | Votação            | `{ userIds }`                                  | —                                                                                                       | votar/desvotar                           |
| `button`         | Botão              | —                                              | `label`, `automationId`                                                                                 | dispara automação (Prompt 10)            |
| `creation_log`   | Criado por         | sistema (`created_by`, `created_at`)           | —                                                                                                       | não                                      |
| `last_updated`   | Última atualização | sistema (`updated_by`, `updated_at`)           | —                                                                                                       | não                                      |
| `item_id`        | ID do item         | sistema (`id`)                                 | —                                                                                                       | não                                      |

**Colunas vinculadas a campos nativos** (`binding = item.planned_end_date`…) gravam no campo do item (`fields`), usado por cronograma, "Minha semana" e "atrasados".

### Configuração comum

- **Título, descrição** (dica no cabeçalho) e **largura**.
- **Obrigatória** e **obrigatória quando** (condição E/OU) — ver §4.
- **Valor padrão** para novos itens (o status usa `defaultLabelId`).
- **Permissões por papel:** quem pode ver (`viewers.roleIds`) e quem pode editar (`editors.roleIds`); vazio = todos com acesso ao board. Colunas sem permissão de leitura chegam redigidas em REST, GraphQL e WebSocket.
- **Formato numérico** (Número, Fórmula, Rollup): unidade livre com sugestões (UST, R$, h, %), posição (antes/depois) e casas decimais (0–4).
- **Status principal** do board: define "concluído" (data de conclusão, operador `overdue`, progresso).

## 2. Fórmulas

- Referencie colunas pelo título entre chaves: `{UST} * {Valor da UST}`. Ao salvar, o título vira a chave (`{c_ust}`), então renomear colunas não quebra a fórmula.
- Argumentos separados por `;` ou `,`. Operadores: `+ - * / ^`, `&` (concatenação), `= <> < <= > >=` e `%` sufixo.
- Números são **decimais exatos** (sem `float`); resultados são guardados com até 4 casas e exibidos com o formato da coluna.
- Datas: `DATE(2026; 10; 15)`, diferenças com `DAYS`, dias úteis com `WORKDAYS`/`ADD_WORKDAYS` usando o calendário do board (feriados nacionais e do tenant).
- Erros aparecem na célula: `#DIV/0!`, `#VALUE!`, `#REF!` (referência inexistente ou ciclo), `#NAME?` (função desconhecida), `#NUM!` (número fora do limite), `#N/A`.
- `TODAY()` e `NOW()` tornam a fórmula **volátil**: recalculada todo dia às 00:05 (America/Sao_Paulo).

### Funções (60)

| Categoria   | Funções                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lógicas     | `IF(condição; se_verdadeiro; [se_falso])`, `IFS(condição1; valor1; [condição2; valor2; …])`, `SWITCH(expressão; caso1; valor1; […]; [padrão])`, `AND(lógico1; [lógico2; …])`, `OR(lógico1; [lógico2; …])`, `NOT(lógico)`, `XOR(lógico1; [lógico2; …])`, `IFERROR(valor; valor_se_erro)`                                                                                                                                                                                                                              |
| Matemáticas | `SUM(número1; [número2; …])`, `AVERAGE(número1; [número2; …])`, `AVG(número1; [número2; …])`, `MIN(valor1; [valor2; …])`, `MAX(valor1; [valor2; …])`, `COUNT(valor1; [valor2; …])`, `COUNTA(valor1; [valor2; …])`, `ROUND(número; [casas_decimais])`, `ROUNDUP(número; [casas_decimais])`, `ROUNDDOWN(número; [casas_decimais])`, `CEILING(número; [múltiplo])`, `FLOOR(número; [múltiplo])`, `ABS(número)`, `MOD(número; divisor)`, `POWER(base; expoente)`, `SQRT(número)`, `INT(número)`, `PERCENT(parte; total)` |
| Datas       | `TODAY()`, `NOW()`, `DATE(ano; mês; dia)`, `YEAR(data)`, `MONTH(data)`, `DAY(data)`, `WEEKDAY(data)`, `WEEKNUM(data)`, `DAYS(data_final; data_inicial)`, `WORKDAYS(data_inicial; data_final)`, `ADD_DAYS(data; dias)`, `ADD_WORKDAYS(data; dias_úteis)`, `EDATE(data; meses)`, `EOMONTH(data; meses)`, `FORMAT_DATE(data; [formato])`                                                                                                                                                                                |
| Texto       | `CONCAT(texto1; [texto2; …])`, `CONCATENATE(texto1; [texto2; …])`, `LEN(texto)`, `LEFT(texto; [quantidade])`, `RIGHT(texto; [quantidade])`, `MID(texto; início; quantidade)`, `UPPER(texto)`, `LOWER(texto)`, `TRIM(texto)`, `SUBSTITUTE(texto; antigo; novo)`, `REPLACE(texto; início; quantidade; novo)`, `SEARCH(procurar; texto)`, `CONTAINS(texto; procurar)`, `TEXT(valor; [casas_decimais])`, `VALUE(texto)`, `REPT(texto; vezes)`                                                                            |
| Informação  | `ISERROR(valor)`, `ISBLANK(valor)`, `ISNUMBER(valor)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Exemplos

| Objetivo               | Fórmula                                                               |
| ---------------------- | --------------------------------------------------------------------- |
| Valor da OS            | `ROUND({UST} * {Valor da UST}; 2)`                                    |
| Dias úteis até o prazo | `WORKDAYS(TODAY(); {Prazo})`                                          |
| Atrasado?              | `IF(AND({Prazo} < TODAY(); {Status} <> "Concluído"); "Atrasado"; "")` |
| Código                 | `CONCAT("OS-"; YEAR({Data Emissão OS}); "/"; {Nº Ordem de Serviço})`  |
| % do orçamento         | `PERCENT({Realizado}; {Previsto})`                                    |

## 3. Colunas calculadas entre itens

- **Espelho:** mostra valores de uma coluna dos itens ligados por uma coluna de Relação (`list`, `sum`, `avg`, `min`, `max`, `count`, `earliest`, `latest`).
- **Rollup:** agrega uma coluna dos **subitens** ou dos itens **relacionados** (`sum`, `avg`, `min`, `max`, `count`, `count_non_empty`, `earliest`, `latest`, `done_percent`).
- **Progresso:** % de colunas de status concluídas no item, ou % de subitens concluídos.
- Recalculadas pelo worker quando os itens de origem mudam (ADR 0038); fórmulas do item que dependem delas são reaplicadas.

## 4. Obrigatoriedade

- **Obrigatória:** exigida ao criar o item e ao esvaziar o campo.
- **Obrigatória quando:** condição E/OU sobre outras colunas (mesmos operadores e tokens dos filtros). Exigida quando a mudança faz a condição passar a valer, ou quando o campo é esvaziado com a condição valendo.
- Exemplo do Gherkin: "Processo SEI" obrigatória quando "OS emitida" é "Sim". Ao marcar "Sim", a Tabela abre **Campos obrigatórios**; sem preencher, nada é salvo. A API impõe a mesma regra (422 `required_fields_missing`).
- Itens antigos que já violavam uma regra nova não bloqueiam edições de outros campos. Subitens e colunas calculadas não entram na regra.

## 5. View Tabela

### Estrutura

- Grupos coloridos (renomear, cor, recolher, reordenar, duplicar com ou sem itens, mover para outro board, arquivar, excluir para a lixeira) e **agrupamento em até 3 níveis** por grupo, status, lista, pessoas, caixa, data (mês), tags, país, texto ou avaliação.
- **Subitens** expansíveis com linha própria de adicionar; contadores na linha do item (subitens, anexos, atualizações e não lidas).
- **Rodapé por balde:** soma/média/mínimo/máximo/contagem para numéricas (conforme a coluna), **barra de distribuição** para status e listas, preenchidos/total para as demais.
- Colunas **fixadas**, **redimensionáveis** (arrastar ou setas no separador), **reordenáveis** (arrastar o cabeçalho ou menu "mover"), **ocultáveis** e configuráveis pelo menu do cabeçalho.

### Filtros, busca e ordenação

- Construtor **E/OU** com grupos, operadores por tipo (é, não é, qualquer de, nenhum de, contém, maior/menor, antes/depois, vazio, **atrasado**) e tokens: **Eu** (inclui meus times), **hoje**, amanhã, ontem, **esta semana**, semana passada/próxima, este mês, mês passado/próximo, próximos/últimos 7 dias.
- Busca por nome e textos do item; filtro rápido por pessoa.
- Ordenação **múltipla** (até 3 critérios): clique no cabeçalho alterna crescente → decrescente → nenhuma; Shift+clique acrescenta critério.
- Tudo avaliado **no servidor** (com as permissões de coluna); a Tabela carrega páginas de 500 itens até o fim.

### Edição e teclado

| Tecla                                           | Ação                                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Setas, Tab/Shift+Tab, Home/End, PageUp/PageDown | Move a célula ativa (Ctrl+setas: extremidades)                                                                    |
| Shift + setas / Shift + clique / arrastar       | Seleção retangular                                                                                                |
| Enter, F2, duplo clique ou 2º clique            | Edita a célula (listas, datas e pessoas abrem popover)                                                            |
| Digitar                                         | Começa a editar textos e números substituindo o conteúdo                                                          |
| Esc                                             | Cancela a edição; limpa a seleção                                                                                 |
| Delete / Backspace                              | Limpa as células selecionadas                                                                                     |
| Ctrl+C / Ctrl+X / Ctrl+V                        | Copia, recorta e cola como TSV (compatível com Excel e Google Sheets); uma célula copiada preenche toda a seleção |
| Ctrl+D                                          | Preenche para baixo                                                                                               |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y                  | Desfaz / refaz (também pelos botões da barra)                                                                     |
| Ctrl+A                                          | Seleciona todas as células                                                                                        |
| Espaço                                          | Marca/desmarca a linha (ou a caixa de seleção)                                                                    |
| Tecla Menu / Shift+F10                          | Menu da linha                                                                                                     |

Ao colar, cada texto é convertido pelo tipo da coluna (datas `dd/mm/aaaa`, números `1.234,56`, rótulos e pessoas pelo nome). Células somente leitura, sem permissão ou com texto inválido são ignoradas e contadas no aviso.

### Ações

- **Linha:** adicionar subitem, duplicar (com subitens), mover para grupo ou outro board (com mapeamento de colunas), arquivar, excluir.
- **Em massa** (barra inferior com a seleção): editar um campo para todos, duplicar, mover, exportar CSV da seleção, arquivar, excluir.
- **Board:** novo grupo, importar CSV/Excel com mapeamento, exportar CSV/Excel (filtros e ordenação atuais), lixeira (restaurar itens e grupos por 30 dias).

### Tempo real

Toda alteração aparece nos outros navegadores sem recarregar; a célula alterada por outra pessoa ganha um contorno de destaque por 2,5 s. Conflitos usam LWW por campo (ADR 0008): se duas pessoas editam o mesmo campo, vence a última gravação e a outra vê o valor atual com aviso.

## 6. Conversão texto ↔ valor

`parseCellText`/`formatCellText` (`packages/shared/src/columns/text.ts`) são usados ao colar, importar, exportar e mover itens entre boards, garantindo ida e volta:

| Tipo          | Texto aceito (pt-BR)                                        | Texto gerado                              |
| ------------- | ----------------------------------------------------------- | ----------------------------------------- |
| Número        | `1234,5`, `1.234,50`, `R$ 10`                               | `1.234,50` (exibição) / `1234,50` (cópia) |
| Data          | `15/10/2026`, `2026-10-15`, `15/10/26`                      | `15/10/2026`                              |
| Período       | `01/10/2026 - 15/10/2026`                                   | idem                                      |
| Status, lista | nome do rótulo/opção (sem diferenciar acentos e maiúsculas) | nome                                      |
| Pessoas       | nomes ou e-mails separados por vírgula                      | nomes                                     |
| Caixa         | `sim`, `x`, `true`, `1` / `não`, vazio                      | `Sim`                                     |
| Link          | `https://…` ou `texto (https://…)`                          | idem                                      |
