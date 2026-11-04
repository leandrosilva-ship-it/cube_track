/**
 * Importadores (Prompt 15, ADR 0056): Monday, Jira e Pipefy exportam CSV tabular — o mesmo motor de
 * mapeamento de colunas + `parseCellText` já usado pelo import de CSV/Excel genérico (Prompt 5,
 * `apps/api/src/modules/work/application/import-export.service.ts`) resolve esses três sem um parser
 * dedicado; só a SUGESTÃO de mapeamento ganha heurísticas por origem (reconhecer "Group"/"Status" do
 * Monday, "Summary"/"Assignee" do Jira, "Fase"/"Responsável" do Pipefy). Trello exporta um JSON de
 * board inteiro (listas+cartões), então precisa de um normalizador dedicado
 * (`trelloExportToTable`) que o converte para a MESMA forma tabular — depois disso, é o mesmo
 * pipeline de mapeamento/prévia/commit de qualquer outra origem. MS Project e Excel/CSV puro já têm
 * seus próprios importadores (Prompts 5/8), não tocados aqui.
 */

export const IMPORT_SOURCES = ['csv', 'monday', 'trello', 'jira', 'pipefy'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export function isImportSource(value: string): value is ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value);
}

export const IMPORT_JOB_STATUSES = ['uploaded', 'processing', 'completed', 'failed'] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/** Alvo de uma coluna da planilha de origem: ignorada, nome do item, grupo, ou uma coluna real do board. */
export type ImportMappingTarget = { type: 'ignore' } | { type: 'name' } | { type: 'group' } | { type: 'column'; key: string };
export type ImportMapping = Record<number, ImportMappingTarget>;

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportJobResult {
  created: number;
  skipped: number;
  errors: ImportRowError[];
}

export interface ImportTable {
  headers: string[];
  rows: string[][];
}

const MAX_TRELLO_CARDS = 5_000;

interface TrelloLabel {
  name?: unknown;
}
interface TrelloMember {
  id?: unknown;
  fullName?: unknown;
  username?: unknown;
}
interface TrelloList {
  id?: unknown;
  name?: unknown;
}
interface TrelloCard {
  idList?: unknown;
  name?: unknown;
  desc?: unknown;
  due?: unknown;
  closed?: unknown;
  idMembers?: unknown;
  labels?: unknown;
}
interface TrelloExport {
  lists?: unknown;
  cards?: unknown;
  members?: unknown;
}

/** Converte o JSON de export de um board do Trello (`lists`+`cards`+`members`) para a forma tabular
 * genérica `{headers, rows}` — depois disso, segue o MESMO mapeamento/prévia/commit de qualquer CSV. */
export function trelloExportToTable(raw: unknown): ImportTable {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as TrelloExport).lists) || !Array.isArray((raw as TrelloExport).cards)) {
    throw new Error('Arquivo de export do Trello inválido: esperado um JSON com "lists" e "cards".');
  }
  const data = raw as TrelloExport;
  const listNameById = new Map<string, string>();
  for (const list of data.lists as TrelloList[]) {
    if (typeof list.id === 'string' && typeof list.name === 'string') listNameById.set(list.id, list.name);
  }
  const memberNameById = new Map<string, string>();
  for (const member of (Array.isArray(data.members) ? (data.members as TrelloMember[]) : [])) {
    if (typeof member.id !== 'string') continue;
    const name = typeof member.fullName === 'string' ? member.fullName : typeof member.username === 'string' ? member.username : null;
    if (name !== null) memberNameById.set(member.id, name);
  }

  const headers = ['Group', 'Name', 'Description', 'Due', 'Members', 'Labels'];
  const rows: string[][] = [];
  const cards = (data.cards as TrelloCard[]).slice(0, MAX_TRELLO_CARDS);
  for (const card of cards) {
    if (card.closed === true) continue;
    const group = typeof card.idList === 'string' ? (listNameById.get(card.idList) ?? '') : '';
    const name = typeof card.name === 'string' ? card.name : '';
    if (name.trim() === '') continue;
    const description = typeof card.desc === 'string' ? card.desc : '';
    const due = typeof card.due === 'string' ? card.due.slice(0, 10) : '';
    const memberIds = Array.isArray(card.idMembers) ? (card.idMembers as unknown[]).filter((id): id is string => typeof id === 'string') : [];
    const members = memberIds.map((id) => memberNameById.get(id)).filter((entry): entry is string => entry !== undefined).join(', ');
    const labels = Array.isArray(card.labels)
      ? (card.labels as TrelloLabel[]).map((label) => (typeof label.name === 'string' ? label.name : '')).filter((entry) => entry !== '').join(', ')
      : '';
    rows.push([group, name, description, due, members, labels]);
  }
  return { headers, rows };
}

/** Variações de cabeçalho conhecidas por origem — usadas só para SUGERIR o mapeamento inicial; o
 * usuário sempre pode corrigir na tela antes de confirmar (nunca aplicado às cegas). */
const HEADER_ALIASES: Record<ImportSource, { group: string[]; status: string[]; person: string[]; date: string[] }> = {
  csv: { group: ['group', 'grupo'], status: ['status', 'estado'], person: ['person', 'people', 'owner', 'responsável', 'responsavel'], date: ['date', 'data', 'due', 'prazo'] },
  monday: { group: ['group'], status: ['status'], person: ['person', 'people', 'owner'], date: ['date', 'timeline', 'due date'] },
  trello: { group: ['group'], status: [], person: ['members'], date: ['due'] },
  jira: { group: ['status'], status: ['status'], person: ['assignee'], date: ['due date', 'created', 'updated'] },
  pipefy: { group: ['fase', 'phase'], status: ['fase', 'phase'], person: ['responsável', 'responsavel', 'assignee'], date: ['data', 'date'] },
};

/** Sugestão inicial de mapeamento: casa o nome do cabeçalho (normalizado) com o título de uma coluna
 * do board, ou com os papéis especiais (nome/grupo) conforme os aliases conhecidos da origem. */
export function suggestImportMapping(
  source: ImportSource,
  headers: readonly string[],
  boardColumns: readonly { key: string; title: string }[],
): ImportMapping {
  const aliases = HEADER_ALIASES[source];
  const normalize = (value: string): string => value.trim().toLowerCase();
  const columnByTitle = new Map(boardColumns.map((column) => [normalize(column.title), column.key]));
  const mapping: ImportMapping = {};
  headers.forEach((header, index) => {
    const normalized = normalize(header);
    if (normalized === 'name' || normalized === 'nome' || normalized === 'title' || normalized === 'summary' || normalized === 'título' || normalized === 'card name') {
      mapping[index] = { type: 'name' };
      return;
    }
    if (aliases.group.includes(normalized)) {
      mapping[index] = { type: 'group' };
      return;
    }
    const columnKey = columnByTitle.get(normalized);
    if (columnKey !== undefined) {
      mapping[index] = { type: 'column', key: columnKey };
      return;
    }
    mapping[index] = { type: 'ignore' };
  });
  return mapping;
}
