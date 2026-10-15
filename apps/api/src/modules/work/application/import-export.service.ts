import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  formatCellText,
  isColumnType,
  newId,
  normalizeForMatch,
  parseCellText,
  parseCsv,
  positionBetween,
  READ_ONLY_COLUMN_TYPES,
  toCsv,
  type CellTextDirectory,
  type CellTextLocale,
  type FilterGroup,
  type SortTerm,
} from '@cube-track/shared';
import ExcelJS from 'exceljs';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import {
  AppError,
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableError,
  ValidationError,
} from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { REDIS } from '../../../core/redis/redis.module.js';
import { AccessService } from '../../access/application/access.service.js';
import type { ColumnDefinition } from '../domain/board-definition.js';
import type { ItemDto } from '../domain/item.js';
import { ItemsRepository } from '../infrastructure/items.repository.js';
import { ItemWriter, type WriteContext } from './item-writer.js';
import { ItemsService } from './items.service.js';

const { groups, statusLabels, dropdownOptions, memberships, users, teams } = schema;

/** Limites (ADR 0042): arquivo de até 10 MB, 5.000 linhas por importação, prévia por 30 min. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5_000;
const IMPORT_TTL_SECONDS = 1_800;
const MAX_REPORTED_ERRORS = 200;

/** Destino de uma coluna da planilha: nome do item, grupo, coluna do board ou ignorar. */
export type ImportTarget = 'name' | 'group' | `column:${string}` | null;

interface StoredImport {
  boardId: string;
  userId: string;
  fileName: string;
  headers: string[];
  rows: string[][];
}

export interface ImportPreview {
  importId: string;
  fileName: string;
  headers: string[];
  sample: string[][];
  totalRows: number;
  suggestedMapping: Record<string, ImportTarget>;
}

export interface ImportCommitInput {
  mapping: Record<string, ImportTarget>;
  /** Grupo das linhas sem grupo mapeado (ou com grupo vazio). */
  groupId: string;
  /** Cria rótulos, opções e grupos citados na planilha que ainda não existem. */
  createMissing: boolean;
  locale: CellTextLocale;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: { row: number; column: string | null; message: string }[];
}

export interface ExportOptions {
  format: 'csv' | 'xlsx';
  locale: CellTextLocale;
  filter: FilterGroup | null;
  sort: SortTerm[];
  search: string | undefined;
}

/** Importação (CSV/Excel com mapeamento) e exportação (CSV/Excel) de itens (ADR 0042). */
@Injectable()
export class ImportExportService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly items: ItemsService,
    private readonly repository: ItemsRepository,
    private readonly writer: ItemWriter,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ------------------------------------------------------------------------------ importação ---

  async preview(
    user: AuthPrincipal,
    boardId: string,
    input: { fileName: string; contentBase64: string },
  ): Promise<ImportPreview> {
    await this.access.assert(user, 'item.create', { type: 'board', id: boardId }, 'Board');
    const buffer = Buffer.from(input.contentBase64, 'base64');
    if (buffer.byteLength > IMPORT_MAX_BYTES)
      throw new PayloadTooLargeError('Arquivo acima de 10 MB.');
    const table = await this.readTable(input.fileName, buffer);
    const [headerRow, ...rows] = table;
    if (headerRow === undefined || rows.length === 0)
      throw new UnprocessableError('A planilha não tem linhas de dados.', 'import_empty');
    if (rows.length > IMPORT_MAX_ROWS)
      throw new UnprocessableError(
        `Máximo de ${String(IMPORT_MAX_ROWS)} linhas por importação.`,
        'import_too_large',
      );
    const headers = headerRow.map((header, index) => header.trim() || `#${String(index + 1)}`);
    const width = headers.length;
    const normalizedRows = rows.map((row) =>
      Array.from({ length: width }, (_, index) => row[index] ?? ''),
    );
    const importId = newId();
    const stored: StoredImport = {
      boardId,
      userId: user.userId,
      fileName: input.fileName,
      headers,
      rows: normalizedRows,
    };
    await this.redis.set(
      this.key(user, importId),
      JSON.stringify(stored),
      'EX',
      IMPORT_TTL_SECONDS,
    );
    const context = await this.writer.context(user, boardId);
    return {
      importId,
      fileName: input.fileName,
      headers,
      sample: normalizedRows.slice(0, 10),
      totalRows: normalizedRows.length,
      suggestedMapping: suggestImportMapping(headers, context.definition.columns),
    };
  }

  async commit(
    user: AuthPrincipal,
    boardId: string,
    importId: string,
    input: ImportCommitInput,
  ): Promise<ImportResult> {
    await this.access.assert(user, 'item.create', { type: 'board', id: boardId }, 'Board');
    const raw = await this.redis.get(this.key(user, importId));
    if (raw === null) throw new NotFoundError('Importação');
    const stored = JSON.parse(raw) as StoredImport;
    if (stored.boardId !== boardId || stored.userId !== user.userId)
      throw new NotFoundError('Importação');
    const tx = this.runner.tx;
    const context = await this.writer.context(user, boardId);
    const group = await this.repository.findGroup(tx, input.groupId);
    if (group?.boardId !== boardId)
      throw new ValidationError([
        { path: 'body.groupId', message: 'Grupo não pertence ao board.' },
      ]);
    const entries = Object.entries(input.mapping).filter(([, target]) => target !== null);
    const nameIndex = entries.find(([, target]) => target === 'name')?.[0];
    if (nameIndex === undefined)
      throw new ValidationError([
        { path: 'body.mapping', message: 'Mapeie uma coluna para o nome do item.' },
      ]);
    const groupIndex = entries.find(([, target]) => target === 'group')?.[0];
    const columnTargets = entries.flatMap(([index, target]) => {
      if (!target?.startsWith('column:')) return [];
      const column = this.importableColumn(context, target.slice('column:'.length));
      return [{ index: Number(index), column }];
    });
    for (const { column } of columnTargets)
      await this.writer.assertColumnWrite(context, column, undefined);
    if (
      input.createMissing &&
      columnTargets.some(({ column }) => column.type === 'status' || column.type === 'dropdown')
    )
      await this.access.assert(user, 'column.manage', { type: 'board', id: boardId }, 'Board');

    const directory = await this.directory();
    const groupsByName = new Map<string, string>(
      (
        await tx
          .select({ id: groups.id, name: groups.name })
          .from(groups)
          .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)))
      ).map((row) => [normalizeForMatch(row.name), row.id]),
    );
    const lastPositions = new Map<string, string | null>();
    const result: ImportResult = { created: 0, skipped: 0, errors: [] };
    const report = (row: number, column: string | null, message: string) => {
      if (result.errors.length < MAX_REPORTED_ERRORS) result.errors.push({ row, column, message });
    };

    for (const [rowIndex, row] of stored.rows.entries()) {
      const rowNumber = rowIndex + 2;
      const name = (row[Number(nameIndex)] ?? '').trim();
      if (name === '') {
        result.skipped += 1;
        report(rowNumber, null, 'Linha sem nome.');
        continue;
      }
      let groupId = input.groupId;
      const groupName = groupIndex === undefined ? '' : (row[Number(groupIndex)] ?? '').trim();
      if (groupName !== '') {
        const existing = groupsByName.get(normalizeForMatch(groupName));
        if (existing !== undefined) groupId = existing;
        else if (input.createMissing) {
          groupId = await this.createGroup(user, boardId, groupName);
          groupsByName.set(normalizeForMatch(groupName), groupId);
        }
      }
      const values: Record<string, unknown> = {};
      let failed = false;
      for (const { index, column } of columnTargets) {
        const text = row[index] ?? '';
        let parsed = parseCellText(column, text, directory, input.locale);
        if (
          !parsed.ok &&
          input.createMissing &&
          (parsed.reason === 'unknown_label' || parsed.reason === 'unknown_option')
        ) {
          await this.createChoices(user, boardId, column, parsed.unknown ?? []);
          parsed = parseCellText(column, text, directory, input.locale);
        }
        if (!parsed.ok) {
          failed = true;
          report(rowNumber, column.title, describeParseFailure(parsed.reason, parsed.unknown));
          continue;
        }
        if (parsed.value !== null) values[column.key] = parsed.value;
      }
      if (failed) {
        result.skipped += 1;
        continue;
      }
      if (!lastPositions.has(groupId))
        lastPositions.set(groupId, await this.repository.lastPosition(tx, groupId, null));
      const position = positionBetween(lastPositions.get(groupId) ?? null, null);
      try {
        const item = await this.writer.insert(
          context,
          { groupId, name, values, position },
          { checkPermissions: false },
        );
        lastPositions.set(groupId, position);
        await this.writer.emitCreated(context, item, 'imported', false);
        result.created += 1;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        result.skipped += 1;
        report(rowNumber, null, error.message);
      }
    }
    this.events.recordChange({
      action: 'board.imported',
      entityType: 'board',
      entityId: boardId,
      boardId,
      after: { fileName: stored.fileName, created: result.created, skipped: result.skipped },
    });
    await this.redis.del(this.key(user, importId));
    return result;
  }

  // ------------------------------------------------------------------------------ exportação ---

  async export(
    user: AuthPrincipal,
    boardId: string,
    options: ExportOptions,
  ): Promise<{ fileName: string; contentType: string; body: Buffer }> {
    await this.access.assert(user, 'board.export', { type: 'board', id: boardId }, 'Board');
    const context = await this.writer.context(user, boardId);
    const columns = context.definition.columns.filter(
      (column) => !context.visibility.hidden.has(column.key) && column.type !== 'button',
    );
    const groupNames = new Map(
      (
        await this.runner.tx
          .select({ id: groups.id, name: groups.name, position: groups.position })
          .from(groups)
          .where(eq(groups.boardId, boardId))
          .orderBy(asc(groups.position))
      ).map((row) => [row.id, row.name]),
    );
    const directory = await this.directory();
    const header = ['Item', groupLabel(options.locale), ...columns.map((column) => column.title)];
    const rows: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await this.items.list(user, boardId, {
        filter: options.filter,
        sort: options.sort,
        limit: 1_000,
        cursor,
        groupId: undefined,
        parentItemId: null,
        includeArchived: false,
        search: options.search,
      });
      for (const item of page.data) {
        rows.push([
          item.name,
          groupNames.get(item.groupId) ?? '',
          ...columns.map((column) =>
            formatCellText(column, cellValue(column, item), directory, {
              locale: options.locale,
              withUnit: options.format === 'xlsx' ? false : true,
              item,
            }),
          ),
        ]);
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor !== undefined);
    this.events.recordChange({
      action: 'board.exported',
      entityType: 'board',
      entityId: boardId,
      boardId,
      after: { format: options.format, rows: rows.length },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    if (options.format === 'csv') {
      return {
        fileName: `board-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: Buffer.from(toCsv(header, rows, options.locale), 'utf8'),
      };
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Itens');
    sheet.addRow(header).font = { bold: true };
    for (const row of rows) {
      sheet.addRow(
        row.map((text, index) => {
          const column = columns[index - 2];
          return column === undefined ? text : excelCell(column, text, options.locale);
        }),
      );
    }
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
    sheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 40 : 18;
    });
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      fileName: `board-${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body,
    };
  }

  // ------------------------------------------------------------------------------ internos ---

  private key(user: AuthPrincipal, importId: string): string {
    return `import:${user.tenantId}:${importId}`;
  }

  private importableColumn(context: WriteContext, key: string): ColumnDefinition {
    const column = context.definition.columns.find((entry) => entry.key === key);
    if (column === undefined || context.visibility.hidden.has(key))
      throw new ValidationError([{ path: 'body.mapping', message: `Coluna inexistente: ${key}` }]);
    if (
      column.binding !== null ||
      (isColumnType(column.type) && READ_ONLY_COLUMN_TYPES.has(column.type))
    )
      throw new ValidationError([
        { path: 'body.mapping', message: `A coluna "${column.title}" não aceita importação.` },
      ]);
    return column;
  }

  private async readTable(fileName: string, buffer: Buffer): Promise<string[][]> {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.tsv'))
      return parseCsv(buffer.toString('utf8'));
    if (!lower.endsWith('.xlsx'))
      throw new UnprocessableError('Formato não suportado (use .csv ou .xlsx).', 'import_format');
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new UnprocessableError('Não foi possível ler a planilha.', 'import_unreadable');
    }
    const sheet = workbook.worksheets[0];
    if (sheet === undefined) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        cells[columnNumber - 1] = excelText(cell.value);
      });
      rows.push(Array.from({ length: cells.length }, (_, index) => cells[index] ?? ''));
    });
    return rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  }

  private async directory(): Promise<CellTextDirectory> {
    const tx = this.runner.tx;
    const people = await tx
      .select({ id: users.id, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(isNull(memberships.deletedAt));
    const teamRows = await tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(isNull(teams.deletedAt));
    return { people, teams: teamRows };
  }

  private async createGroup(user: AuthPrincipal, boardId: string, name: string): Promise<string> {
    const tx = this.runner.tx;
    const [last] = await tx
      .select({ position: groups.position })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)))
      .orderBy(asc(groups.position));
    const id = newId();
    await tx.insert(groups).values({
      id,
      tenantId: user.tenantId,
      boardId,
      name,
      position: positionBetween(null, last?.position ?? null),
      createdBy: user.userId,
    });
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'group.changed',
      aggregateType: 'group',
      aggregateId: id,
      boardId,
      payload: { groupId: id, change: 'created' },
      actorId: user.userId,
    });
    return id;
  }

  /** Cria rótulos/opções citados na planilha (e atualiza a coluna em memória). */
  private async createChoices(
    user: AuthPrincipal,
    boardId: string,
    column: ColumnDefinition,
    labels: string[],
  ): Promise<void> {
    const tx = this.runner.tx;
    for (const label of [...new Set(labels.map((entry) => entry.trim()))].filter(
      (entry) => entry !== '',
    )) {
      const id = newId();
      if (column.type === 'status') {
        const position = positionBetween(column.labels.at(-1)?.position ?? null, null);
        await tx.insert(statusLabels).values({
          id,
          tenantId: user.tenantId,
          columnId: column.id,
          label,
          color: '#579bfc',
          category: 'in_progress',
          position,
          createdBy: user.userId,
        });
        column.labels.push({ id, label, color: '#579bfc', category: 'in_progress', position });
      } else {
        const position = positionBetween(column.options.at(-1)?.position ?? null, null);
        await tx.insert(dropdownOptions).values({
          id,
          tenantId: user.tenantId,
          columnId: column.id,
          label,
          position,
          createdBy: user.userId,
        });
        column.options.push({ id, label, color: null, position });
      }
    }
    await this.access.invalidate(user.tenantId);
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'column.updated',
      aggregateType: 'column',
      aggregateId: column.id,
      boardId,
      payload: { columnId: column.id, key: column.key, changes: { choices: labels } },
      actorId: user.userId,
    });
  }
}

/** Sugestão de mapeamento: "Nome"/"Item" → nome, "Grupo" → grupo, títulos iguais → coluna. */
export function suggestImportMapping(
  headers: readonly string[],
  columns: readonly ColumnDefinition[],
): Record<string, ImportTarget> {
  const mapping: Record<string, ImportTarget> = {};
  const used = new Set<string>();
  headers.forEach((header, index) => {
    const normalized = normalizeForMatch(header);
    let target: ImportTarget = null;
    if (
      ['nome', 'name', 'item', 'titulo', 'title', 'nombre'].includes(normalized) &&
      !used.has('name')
    )
      target = 'name';
    else if (['grupo', 'group'].includes(normalized) && !used.has('group')) target = 'group';
    else {
      const column = columns.find(
        (entry) =>
          normalizeForMatch(entry.title) === normalized &&
          entry.binding === null &&
          !(isColumnType(entry.type) && READ_ONLY_COLUMN_TYPES.has(entry.type)),
      );
      if (column !== undefined && !used.has(`column:${column.key}`))
        target = `column:${column.key}`;
    }
    if (target !== null) used.add(target);
    mapping[String(index)] = target;
  });
  if (!used.has('name') && headers.length > 0 && mapping['0'] === null) mapping['0'] = 'name';
  return mapping;
}

function describeParseFailure(reason: string, unknown: string[] | undefined): string {
  const list = unknown === undefined || unknown.length === 0 ? '' : `: ${unknown.join(', ')}`;
  switch (reason) {
    case 'unknown_label':
      return `Rótulo inexistente${list}.`;
    case 'unknown_option':
      return `Opção inexistente${list}.`;
    case 'unknown_person':
      return `Pessoa ou time não encontrado${list}.`;
    case 'unknown_item':
      return `Item relacionado não encontrado${list}.`;
    default:
      return 'Valor inválido para o tipo da coluna.';
  }
}

function groupLabel(locale: CellTextLocale): string {
  return locale === 'en' ? 'Group' : 'Grupo';
}

/** Valor da célula no DTO (colunas vinculadas leem o campo nativo). */
function cellValue(column: ColumnDefinition, item: ItemDto): unknown {
  if (column.binding?.startsWith('item.') === true) {
    const field = column.binding
      .slice(5)
      .replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    const value = (item as unknown as Record<string, unknown>)[field];
    if (typeof value !== 'string') return null;
    return column.binding === 'item.progress' ? { n: value } : { d: value };
  }
  return item.values[column.key];
}

/** Célula do Excel: números como número, datas como data; o resto como texto. */
function excelCell(
  column: ColumnDefinition,
  text: string,
  locale: CellTextLocale,
): string | number | Date {
  if (text === '') return text;
  if (['number', 'rating', 'time_tracking', 'formula', 'rollup'].includes(column.type)) {
    const normalized = locale === 'en' ? text : text.replace(/\./g, '').replace(',', '.');
    const value = Number(normalized);
    if (Number.isFinite(value) && /^-?\d+(\.\d+)?$/.test(normalized)) return value;
  }
  if (column.type === 'date' && column.settings.includeTime !== true) {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (match !== null) {
      const [day, month, year] =
        locale === 'en' ? [match[2], match[1], match[3]] : [match[1], match[2], match[3]];
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    }
  }
  return text;
}

/** Texto de uma célula lida do Excel (datas em ISO, fórmulas pelo resultado, rich text plano). */
function excelText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return excelText(value.result);
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('hyperlink' in value) return value.hyperlink;
    return '';
  }
  return String(value);
}
