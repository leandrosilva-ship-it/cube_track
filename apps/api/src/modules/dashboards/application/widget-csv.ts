import type { WidgetData } from './widget-data.service.js';

/** Converte o dado já computado de um widget em linhas tabulares para exportação CSV. */
export function widgetDataToCsvRows(title: string, data: WidgetData): { header: string[]; rows: string[][] } {
  switch (data.kind) {
    case 'number':
      return { header: [title], rows: [[data.value ?? '']] };
    case 'chart':
      return {
        header: ['Categoria', 'Valor'],
        rows: data.categories.map((entry) => [entry.label, String(entry.value)]),
      };
    case 'battery':
      return {
        header: ['Categoria', 'Quantidade'],
        rows: [
          ['No prazo', String(data.onTime)],
          ['Replanejado', String(data.replanned)],
          ['Atrasado', String(data.late)],
          ['Sem data', String(data.noDate)],
        ],
      };
    case 'workload':
      return {
        header: ['Pessoa', 'Valor'],
        rows: data.people.map((entry) => [entry.personName, String(entry.value)]),
      };
    case 'project_health':
      return {
        header: ['Data', 'Geral'],
        rows: data.history.map((entry) => [entry.reportedAt, entry.overall]),
      };
    case 'capacity':
      return {
        header: ['Pessoa', 'Período', 'Disponível (h)', 'Alocado (h)', 'Utilização', 'Sobrealocado'],
        rows: data.rows.flatMap((row) =>
          row.buckets.map((bucket) => [
            row.userName,
            bucket.bucket,
            bucket.availableHours.toFixed(2),
            bucket.allocatedHours.toFixed(2),
            Number.isFinite(bucket.utilization) ? `${(bucket.utilization * 100).toFixed(0)}%` : '∞',
            bucket.overallocated ? 'Sim' : 'Não',
          ]),
        ),
      };
  }
}
