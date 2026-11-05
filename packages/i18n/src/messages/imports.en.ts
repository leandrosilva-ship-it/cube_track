export const importsEn = {
  title: 'Import into the board',
  description: 'Monday, Trello, Jira, Pipefy or a generic CSV — processed in the background.',
  next: 'Next',
  source: {
    label: 'Source',
    csv: { label: 'CSV/Excel', hint: 'Upload a CSV file with a header row.' },
    monday: {
      label: 'Monday.com',
      hint: 'Export the Monday board as CSV (board "..." menu → Export board to Excel) and upload it here.',
    },
    trello: {
      label: 'Trello',
      hint: 'Export the Trello board as JSON (Menu → More → Print and export → Export as JSON) and upload it here.',
    },
    jira: {
      label: 'Jira',
      hint: 'Export the issues as CSV (Filters → Export → Export CSV) and upload it here.',
    },
    pipefy: {
      label: 'Pipefy',
      hint: 'Export the pipe as CSV (pipe menu → Export) and upload it here.',
    },
  },
  upload: {
    choose: 'Choose file',
    reading: 'Uploading…',
    limits: 'Maximum size 10 MB.',
    tooLarge: 'File larger than the 10 MB limit.',
  },
  mapping: {
    ignore: 'Ignore',
    name: 'Item name',
    group: 'Group',
    confirm: 'Import {count, plural, one {# row} other {# rows}}',
    nameRequired: 'Map at least one column to the item name.',
    rowsCount: '{count, plural, one {# row found} other {# rows found}}',
    caption: 'Source column mapping',
    sourceColumn: 'Source column',
    sample: 'Sample',
    target: 'Maps to',
    targetFor: 'Mapping for column {column}',
  },
  progress: {
    processing: 'Processing the import…',
    failedTitle: 'Import failed',
    failedDescription: 'Try again or review the uploaded file.',
    summary: '{created, plural, one {# item created} other {# items created}}, {skipped, plural, one {# row skipped} other {# rows skipped}}.',
    errorsTitle: 'Skipped rows',
    rowError: 'Row {row}: {message}',
  },
};
