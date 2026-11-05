export const importsEs = {
  title: 'Importar al board',
  description: 'Monday, Trello, Jira, Pipefy o un CSV genérico — procesado en segundo plano.',
  next: 'Siguiente',
  source: {
    label: 'Origen',
    csv: { label: 'CSV/Excel', hint: 'Sube un archivo CSV con encabezado en la primera fila.' },
    monday: {
      label: 'Monday.com',
      hint: 'Exporta el board de Monday como CSV (menú "..." del board → Exportar board a Excel) y súbelo aquí.',
    },
    trello: {
      label: 'Trello',
      hint: 'Exporta el board de Trello como JSON (Menú → Más → Imprimir y exportar → Exportar como JSON) y súbelo aquí.',
    },
    jira: {
      label: 'Jira',
      hint: 'Exporta los issues como CSV (Filtros → Exportar → Exportar CSV) y súbelo aquí.',
    },
    pipefy: {
      label: 'Pipefy',
      hint: 'Exporta el pipe como CSV (menú del pipe → Exportar) y súbelo aquí.',
    },
  },
  upload: {
    choose: 'Elegir archivo',
    reading: 'Subiendo…',
    limits: 'Tamaño máximo de 10 MB.',
    tooLarge: 'Archivo mayor que el límite de 10 MB.',
  },
  mapping: {
    ignore: 'Ignorar',
    name: 'Nombre del ítem',
    group: 'Grupo',
    confirm: 'Importar {count, plural, one {# fila} other {# filas}}',
    nameRequired: 'Mapea al menos una columna al nombre del ítem.',
    rowsCount: '{count, plural, one {# fila encontrada} other {# filas encontradas}}',
    caption: 'Mapeo de las columnas de origen',
    sourceColumn: 'Columna de origen',
    sample: 'Muestra',
    target: 'Mapea a',
    targetFor: 'Mapeo de la columna {column}',
  },
  progress: {
    processing: 'Procesando la importación…',
    failedTitle: 'La importación falló',
    failedDescription: 'Inténtalo de nuevo o revisa el archivo subido.',
    summary: '{created, plural, one {# ítem creado} other {# ítems creados}}, {skipped, plural, one {# fila omitida} other {# filas omitidas}}.',
    errorsTitle: 'Filas omitidas',
    rowError: 'Fila {row}: {message}',
  },
};
