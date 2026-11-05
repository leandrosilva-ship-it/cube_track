/** Importação em background (pt-BR, fonte das chaves) — ADR 0056. Ver `features/imports/`. */
export const importsPtBR = {
  title: 'Importar para o board',
  description: 'Monday, Trello, Jira, Pipefy ou um CSV genérico — processado em segundo plano.',
  next: 'Avançar',
  source: {
    label: 'Origem',
    csv: { label: 'CSV/Excel', hint: 'Envie um arquivo CSV com cabeçalho na primeira linha.' },
    monday: {
      label: 'Monday.com',
      hint: 'Exporte o board do Monday como CSV (menu "..." do board → Exportar board para Excel) e envie aqui.',
    },
    trello: {
      label: 'Trello',
      hint: 'Exporte o board do Trello como JSON (Menu → Mais → Imprimir e exportar → Exportar como JSON) e envie aqui.',
    },
    jira: {
      label: 'Jira',
      hint: 'Exporte os issues como CSV (Filtros → Exportar → Exportar CSV) e envie aqui.',
    },
    pipefy: {
      label: 'Pipefy',
      hint: 'Exporte o pipe como CSV (menu do pipe → Exportar) e envie aqui.',
    },
  },
  upload: {
    choose: 'Escolher arquivo',
    reading: 'Enviando…',
    limits: 'Tamanho máximo de 10 MB.',
    tooLarge: 'Arquivo maior que o limite de 10 MB.',
  },
  mapping: {
    ignore: 'Ignorar',
    name: 'Nome do item',
    group: 'Grupo',
    confirm: 'Importar {count, plural, one {# linha} other {# linhas}}',
    nameRequired: 'Mapeie ao menos uma coluna para o nome do item.',
    rowsCount: '{count, plural, one {# linha encontrada} other {# linhas encontradas}}',
    caption: 'Mapeamento das colunas de origem',
    sourceColumn: 'Coluna de origem',
    sample: 'Amostra',
    target: 'Mapeia para',
    targetFor: 'Mapeamento da coluna {column}',
  },
  progress: {
    processing: 'Processando a importação…',
    failedTitle: 'A importação falhou',
    failedDescription: 'Tente novamente ou revise o arquivo enviado.',
    summary: '{created, plural, one {# item criado} other {# itens criados}}, {skipped, plural, one {# linha pulada} other {# linhas puladas}}.',
    errorsTitle: 'Linhas puladas',
    rowError: 'Linha {row}: {message}',
  },
};
