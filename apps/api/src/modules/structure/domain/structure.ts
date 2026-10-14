import { positionBetween } from '@cube-track/shared';

/**
 * Regras puras da estrutura de navegação (workspace → pastas → boards): ordenação por fractional
 * indexing, prevenção de ciclos entre pastas e o modelo inicial de um board novo.
 */

export interface Positioned {
  id: string;
  position: string;
}

/**
 * Posição para inserir entre vizinhos. `afterId` = elemento que fica ANTES do novo; `beforeId` =
 * elemento que fica DEPOIS. Sem vizinhos, vai para o fim da lista.
 */
export function positionAmong(
  siblings: readonly Positioned[],
  neighbors: { afterId?: string | null | undefined; beforeId?: string | null | undefined },
): string {
  const sorted = [...siblings].sort((a, b) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
  );
  const after =
    neighbors.afterId === null || neighbors.afterId === undefined
      ? undefined
      : sorted.find((entry) => entry.id === neighbors.afterId);
  const before =
    neighbors.beforeId === null || neighbors.beforeId === undefined
      ? undefined
      : sorted.find((entry) => entry.id === neighbors.beforeId);
  if (after === undefined && before === undefined)
    return positionBetween(sorted.at(-1)?.position ?? null, null);
  if (after !== undefined && before === undefined) {
    const next = sorted[sorted.indexOf(after) + 1];
    return positionBetween(after.position, next?.position ?? null);
  }
  if (after === undefined && before !== undefined) {
    const previous = sorted[sorted.indexOf(before) - 1];
    return positionBetween(previous?.position ?? null, before.position);
  }
  return positionBetween(after?.position ?? null, before?.position ?? null);
}

/** `candidateParentId` é a própria pasta ou uma descendente dela? (mover criaria um ciclo) */
export function createsCycle(
  folders: readonly { id: string; parentId: string | null }[],
  folderId: string,
  candidateParentId: string | null,
): boolean {
  const parents = new Map(folders.map((folder) => [folder.id, folder.parentId]));
  for (let current = candidateParentId; current !== null; current = parents.get(current) ?? null) {
    if (current === folderId) return true;
  }
  return false;
}

export type SupportedLocale = 'pt-BR' | 'en' | 'es';

const TEMPLATE_TEXT: Record<
  SupportedLocale,
  {
    group: string;
    view: string;
    status: string;
    owner: string;
    due: string;
    labels: [string, string, string, string];
  }
> = {
  'pt-BR': {
    group: 'Novo grupo',
    view: 'Tabela principal',
    status: 'Status',
    owner: 'Responsável',
    due: 'Prazo',
    labels: ['A fazer', 'Em andamento', 'Parado', 'Concluído'],
  },
  en: {
    group: 'New group',
    view: 'Main table',
    status: 'Status',
    owner: 'Owner',
    due: 'Due date',
    labels: ['To do', 'Working on it', 'Stuck', 'Done'],
  },
  es: {
    group: 'Nuevo grupo',
    view: 'Tabla principal',
    status: 'Estado',
    owner: 'Responsable',
    due: 'Fecha límite',
    labels: ['Por hacer', 'En curso', 'Detenido', 'Listo'],
  },
};

export interface BoardTemplate {
  group: { name: string; color: string };
  view: { name: string; type: 'table' };
  columns: {
    key: string;
    type: 'status' | 'people' | 'date';
    title: string;
    width: number;
    binding: string | null;
  }[];
  labels: {
    label: string;
    color: string;
    category: 'not_started' | 'in_progress' | 'stuck' | 'done';
    isDefault: boolean;
  }[];
}

export function normalizeLocale(locale: string | null | undefined): SupportedLocale {
  if (locale === 'en' || locale?.startsWith('en-') === true) return 'en';
  if (locale === 'es' || locale?.startsWith('es-') === true) return 'es';
  return 'pt-BR';
}

/** Modelo inicial de um board: 1 grupo, colunas Status/Responsável/Prazo e a view Tabela. */
export function boardTemplate(locale: SupportedLocale): BoardTemplate {
  const text = TEMPLATE_TEXT[locale];
  return {
    group: { name: text.group, color: '#579bfc' },
    view: { name: text.view, type: 'table' },
    columns: [
      { key: 'c_status', type: 'status', title: text.status, width: 140, binding: null },
      { key: 'c_owner', type: 'people', title: text.owner, width: 140, binding: null },
      { key: 'c_due', type: 'date', title: text.due, width: 130, binding: 'item.planned_end_date' },
    ],
    labels: [
      { label: text.labels[0], color: '#c4c4c4', category: 'not_started', isDefault: true },
      { label: text.labels[1], color: '#fdab3d', category: 'in_progress', isDefault: false },
      { label: text.labels[2], color: '#df2f4a', category: 'stuck', isDefault: false },
      { label: text.labels[3], color: '#00c875', category: 'done', isDefault: false },
    ],
  };
}

/** Início (segunda-feira) da semana ISO que contém `date` (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const weekday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - weekday);
  return value.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
