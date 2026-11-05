import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import {
  isTemplateKind,
  parseTemplatePayload,
  positionBetween,
  TemplateConfigError,
  type BoardTemplate,
  type BoardTemplatePayload,
  type FormTemplatePayload,
  type TemplateKind,
} from '@cube-track/shared';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { z, ZodError } from 'zod';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, UnprocessableError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';
import { AutomationsService } from '../../automations/application/automations.service.js';
import { DashboardsService } from '../../dashboards/application/dashboards.service.js';
import { WidgetsService } from '../../dashboards/application/widgets.service.js';
import { FormsService } from '../../forms/application/forms.service.js';
import { StructureService } from '../../structure/application/structure.service.js';
import { ColumnsService } from '../../work/application/columns.service.js';
import { IMPORT_MAX_ROWS } from '../../work/application/import-export.service.js';
import type { ColumnDefinition } from '../../work/domain/board-definition.js';
import { BoardDefinitionRepository } from '../../work/infrastructure/board-definition.repository.js';

const { templates, boards, groups, views, items } = schema;

type TemplateRow = typeof templates.$inferSelect;

export interface TemplateDto {
  id: string;
  tenantId: string | null;
  kind: TemplateKind;
  name: string;
  description: string | null;
  category: string | null;
  payload: Record<string, unknown>;
  version: number;
  usageCount: number;
  isGlobal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  kind: TemplateKind;
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  payload: Record<string, unknown>;
}

export interface UpdateTemplateInput {
  name?: string | undefined;
  description?: string | null | undefined;
  category?: string | null | undefined;
  payload?: Record<string, unknown> | undefined;
}

export interface SaveBoardAsTemplateInput {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  includeItems: boolean;
}

/** Máximo de itens guardados num snapshot "salvar board como template" (mesmo teto do importador). */
const TEMPLATE_SNAPSHOT_MAX_ITEMS = IMPORT_MAX_ROWS;

/** Tipos de coluna cujo valor sobrevive a um snapshot/aplicação (sem referenciar ids que só existem
 * no board de origem — pessoas, arquivos, relações, espelho/rollup/fórmula ficam de fora). */
const PORTABLE_VALUE_TYPES = new Set([
  'text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'checkbox',
  'rating',
]);

function toDto(row: TemplateRow): TemplateDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    // `item` é um `kind` reservado no enum do banco (não implementado nesta entrega, ver
    // `packages/shared/src/templates.ts`) — nunca aparece aqui porque `create`/`saveBoardAsTemplate`
    // nunca gravam esse `kind` e nenhum seed desta entrega o usa.
    kind: row.kind as TemplateKind,
    name: row.name,
    description: row.description,
    category: row.category,
    payload: row.payload,
    version: row.version,
    usageCount: row.usageCount,
    isGlobal: row.tenantId === null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function parsePayload<K extends TemplateKind>(kind: K, raw: unknown) {
  try {
    return parseTemplatePayload(kind, raw);
  } catch (error) {
    if (error instanceof TemplateConfigError)
      throw new UnprocessableError(error.message, 'template_payload_invalid');
    throw error;
  }
}

function parseBody<T>(schema: z.ZodType<T>, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError(
        error.issues.map((issue) => ({ path: `body.${issue.path.join('.')}`, message: issue.message })),
      );
    }
    throw error;
  }
}

/** Monta um `BoardTemplate` (shape exigido por `BoardBlueprintWriter.fromTemplate`) a partir do
 * `BoardTemplatePayload` validado — só `key`/`kind` não existem no payload de template (não precisam:
 * `fromTemplate` nunca os lê), então completamos com valores neutros. */
function toBoardTemplate(payload: BoardTemplatePayload, key: string): BoardTemplate {
  return {
    key,
    kind: 'board',
    name: payload.name,
    description: payload.description,
    icon: payload.icon,
    groups: payload.groups,
    // `zod .optional()` infere `campo?: T | undefined` (chave pode faltar OU vir com `undefined`
    // explícito); `TemplateColumn` (interface escrita à mão) é mais estrito (`campo?: T` — só pode
    // faltar). `parseTemplatePayload` nunca produz uma chave presente com valor `undefined` de
    // verdade, então a asserção é segura (ADR 0056: `exactOptionalPropertyTypes`).
    columns: payload.columns as BoardTemplate['columns'],
    statusColumnKey: payload.statusColumnKey,
    viewName: payload.viewName,
  };
}

function extractRequiredWhenLabel(
  requiredWhen: unknown,
  columnsByKey: Map<string, ColumnDefinition>,
): { columnKey: string; labelIndex: number } | undefined {
  if (requiredWhen === null || typeof requiredWhen !== 'object') return undefined;
  const conditions = (requiredWhen as Record<string, unknown>).conditions;
  if (!Array.isArray(conditions) || conditions.length !== 1) return undefined;
  const condition = conditions[0] as Record<string, unknown>;
  const field = condition.field;
  const value = condition.value;
  if (typeof field !== 'string' || condition.operator !== 'is' || typeof value !== 'string')
    return undefined;
  const refColumn = columnsByKey.get(field);
  if (refColumn === undefined) return undefined;
  const labelIndex = refColumn.labels.findIndex((label) => label.id === value);
  return labelIndex === -1 ? undefined : { columnKey: field, labelIndex };
}

/** Valor de item no formato de snapshot (status/dropdown por TEXTO, não por id — os ids gerados na
 * aplicação do template são sempre novos). `undefined` = valor não portável, fica de fora do snapshot. */
function snapshotValue(column: ColumnDefinition, raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (column.type === 'status') {
    const labelId = record.labelId;
    if (typeof labelId !== 'string') return undefined;
    const label = column.labels.find((entry) => entry.id === labelId);
    return label === undefined ? undefined : { labelText: label.label };
  }
  if (column.type === 'dropdown') {
    const optionIds = record.optionIds;
    if (!Array.isArray(optionIds)) return undefined;
    const texts = optionIds
      .map((id) => column.options.find((entry) => entry.id === id)?.label)
      .filter((label): label is string => label !== undefined);
    return texts.length === 0 ? undefined : { optionTexts: texts };
  }
  if (PORTABLE_VALUE_TYPES.has(column.type)) return record;
  return undefined;
}

/** Inverso de `snapshotValue`: resolve texto → id das escolhas (já criadas no NOVO board). */
function resolveSnapshotValue(column: ColumnDefinition, raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (column.type === 'status') {
    const labelText = record.labelText;
    if (typeof labelText !== 'string') return undefined;
    const label = column.labels.find((entry) => entry.label === labelText);
    return label === undefined ? undefined : { labelId: label.id };
  }
  if (column.type === 'dropdown') {
    const optionTexts = record.optionTexts;
    if (!Array.isArray(optionTexts)) return undefined;
    const ids = optionTexts
      .map((text) => column.options.find((entry) => entry.label === text)?.id)
      .filter((id): id is string => id !== undefined);
    return ids.length === 0 ? undefined : { optionIds: ids };
  }
  if (PORTABLE_VALUE_TYPES.has(column.type)) return record;
  return undefined;
}

// ------------------------------------------------------------------------- corpos de `apply` ---

const ApplyBoardBody = z
  .object({ workspaceId: z.uuid(), name: z.string().trim().min(1).max(120).optional(), folderId: z.uuid().nullable().optional() })
  .strict();
const ApplyWorkspaceBody = z
  .object({ workspaceId: z.uuid().optional(), newWorkspaceName: z.string().trim().min(1).max(120).optional() })
  .strict()
  .refine((value) => (value.workspaceId === undefined) !== (value.newWorkspaceName === undefined), {
    message: 'Informe `workspaceId` (workspace existente) OU `newWorkspaceName` (criar um novo), nunca os dois.',
  });
const ApplyAutomationBody = z.object({ boardId: z.uuid() }).strict();
const ApplyDashboardBody = z
  .object({
    workspaceId: z.uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    sourceBoardIds: z.array(z.uuid()).max(20).optional(),
  })
  .strict();
const ApplyFormBody = z
  .object({ boardId: z.uuid(), targetGroupId: z.uuid().nullable().optional() })
  .strict();

/**
 * Templates (ADR 0056): galeria pública (`tenantId` nulo, somente leitura) + galeria interna do
 * tenant (CRUD com `templates.manage`). Aplicar um template reaproveita o caminho de criação normal
 * de cada módulo (board/workspace/automação/dashboard/formulário) — nunca um segundo motor de
 * criação — então a permissão de cada recurso-alvo (ex.: `board.create` no workspace de destino) é
 * sempre verificada por esse caminho, não aqui.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
    private readonly definitions: BoardDefinitionRepository,
    private readonly columns: ColumnsService,
    private readonly structure: StructureService,
    private readonly automations: AutomationsService,
    private readonly dashboards: DashboardsService,
    private readonly widgets: WidgetsService,
    private readonly forms: FormsService,
  ) {}

  // ------------------------------------------------------------------------------- leitura ---

  /**
   * `scope: 'public'` lista a galeria global (qualquer usuário autenticado, sem permissão extra —
   * são templates da plataforma, somente leitura). `scope: 'internal'` (padrão) lista a galeria do
   * tenant: qualquer membro pode LER (escolher um para aplicar); só `templates.manage` pode
   * criar/editar/excluir — decisão documentada no ADR 0056, mesma lógica de "ver o catálogo" vs.
   * "administrar o catálogo".
   */
  async list(
    user: AuthPrincipal,
    options: { kind?: TemplateKind | undefined; scope?: 'internal' | 'public' | undefined },
  ): Promise<TemplateDto[]> {
    const scope = options.scope ?? 'internal';
    const tenantCondition = scope === 'public' ? isNull(templates.tenantId) : eq(templates.tenantId, user.tenantId);
    const rows = await this.runner.tx
      .select()
      .from(templates)
      .where(
        and(
          tenantCondition,
          isNull(templates.deletedAt),
          eq(templates.isPublished, true),
          options.kind === undefined ? undefined : eq(templates.kind, options.kind),
        ),
      )
      .orderBy(asc(templates.category), asc(templates.name));
    return rows.map(toDto);
  }

  async get(user: AuthPrincipal, id: string): Promise<TemplateDto> {
    return toDto(await this.findReadable(user, id));
  }

  // -------------------------------------------------------------------------------- escrita ---

  async create(user: AuthPrincipal, input: CreateTemplateInput): Promise<TemplateDto> {
    await this.access.assert(user, 'templates.manage', { type: 'tenant' });
    if (!isTemplateKind(input.kind))
      throw new ValidationError([{ path: 'body.kind', message: 'Tipo de template desconhecido.' }]);
    const payload = parsePayload(input.kind, input.payload);
    const [row] = await this.runner.tx
      .insert(templates)
      .values({
        tenantId: user.tenantId,
        kind: input.kind,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        payload: payload as Record<string, unknown>,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar template');
    this.events.recordChange({
      action: 'template.created',
      entityType: 'template',
      entityId: row.id,
      after: { kind: row.kind, name: row.name },
    });
    await this.emitChanged(user, row.id, row.kind, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateTemplateInput): Promise<TemplateDto> {
    await this.access.assert(user, 'templates.manage', { type: 'tenant' });
    const existing = await this.findOwn(user, id);
    const payload =
      input.payload === undefined ? existing.payload : parsePayload(existing.kind as TemplateKind, input.payload);
    const [row] = await this.runner.tx
      .update(templates)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        category: input.category === undefined ? existing.category : input.category,
        payload: payload as Record<string, unknown>,
        version: input.payload === undefined ? existing.version : existing.version + 1,
      })
      .where(eq(templates.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar template');
    this.events.recordChange({ action: 'template.updated', entityType: 'template', entityId: id });
    await this.emitChanged(user, id, row.kind, 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    await this.access.assert(user, 'templates.manage', { type: 'tenant' });
    const existing = await this.findOwn(user, id);
    await this.runner.tx.update(templates).set({ deletedAt: new Date() }).where(eq(templates.id, id));
    this.events.recordChange({
      action: 'template.deleted',
      entityType: 'template',
      entityId: id,
      before: { name: existing.name },
    });
    await this.emitChanged(user, id, existing.kind, 'deleted');
  }

  // --------------------------------------------------------------------------------- aplicar ---

  async apply(user: AuthPrincipal, id: string, rawBody: unknown): Promise<{ kind: TemplateKind; created: Record<string, unknown> }> {
    const template = await this.findReadable(user, id);
    const created = await this.applyByKind(user, template, rawBody);
    await this.runner.tx
      .update(templates)
      .set({ usageCount: sql`${templates.usageCount} + 1` })
      .where(eq(templates.id, template.id));
    return { kind: template.kind as TemplateKind, created };
  }

  private async applyByKind(
    user: AuthPrincipal,
    template: TemplateRow,
    rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    switch (template.kind as TemplateKind) {
      case 'board': {
        const body = parseBody(ApplyBoardBody, rawBody);
        const payload = parsePayload('board', template.payload);
        const board = await this.structure.createBoardFromBlueprint(
          user,
          body.workspaceId,
          toBoardTemplate(payload, template.id),
          { name: body.name, folderId: body.folderId ?? null },
        );
        if (payload.items !== undefined && payload.items.length > 0) {
          await this.applyBoardItems(user, board.id, payload);
        }
        return { boardId: board.id, workspaceId: board.workspaceId };
      }
      case 'workspace': {
        const body = parseBody(ApplyWorkspaceBody, rawBody);
        const payload = parsePayload('workspace', template.payload);
        const workspaceId =
          body.workspaceId ??
          (await this.structure.createWorkspace(user, { name: body.newWorkspaceName ?? template.name })).id;
        const boardIds: string[] = [];
        for (const entry of payload.boards) {
          const board = await this.structure.createBoardFromBlueprint(
            user,
            workspaceId,
            toBoardTemplate(entry.blueprint, template.id),
            { name: entry.name },
          );
          if (entry.blueprint.items !== undefined && entry.blueprint.items.length > 0) {
            await this.applyBoardItems(user, board.id, entry.blueprint);
          }
          boardIds.push(board.id);
        }
        return { workspaceId, boardIds };
      }
      case 'automation': {
        const body = parseBody(ApplyAutomationBody, rawBody);
        const payload = parsePayload('automation', template.payload);
        const automation = await this.automations.createForBoard(user, body.boardId, {
          name: payload.name,
          description: payload.description,
          trigger: payload.trigger,
          actions: payload.actions,
          isEnabled: true,
        });
        return { automationId: automation.id, boardId: body.boardId };
      }
      case 'dashboard': {
        const body = parseBody(ApplyDashboardBody, rawBody);
        const payload = parsePayload('dashboard', template.payload);
        const dashboard = await this.dashboards.create(user, body.workspaceId, {
          name: body.name ?? payload.name,
          sourceBoardIds: body.sourceBoardIds ?? [],
        });
        const widgetIds: string[] = [];
        for (const widget of payload.widgets) {
          const created = await this.widgets.create(user, dashboard.id, {
            type: widget.type,
            title: widget.title,
            config: widget.config,
            layout: widget.layout,
          });
          widgetIds.push(created.id);
        }
        return { dashboardId: dashboard.id, workspaceId: body.workspaceId, widgetIds };
      }
      case 'form': {
        const body = parseBody(ApplyFormBody, rawBody);
        const payload = parsePayload('form', template.payload);
        const form = await this.forms.create(user, body.boardId, {
          name: payload.name,
          description: payload.description,
          targetGroupId: body.targetGroupId ?? null,
        });
        for (const field of payload.fields) {
          const columnKey = await this.ensureNativeColumn(user, body.boardId, field);
          await this.forms.addField(user, form.id, {
            columnKey,
            label: field.label,
            fieldType: field.fieldType,
            isRequired: field.isRequired,
          });
        }
        return { formId: form.id, boardId: body.boardId };
      }
    }
  }

  /** Acha uma coluna do tipo/nome do campo ou cria uma nova (ADR 0056: "criar as colunas nativas que
   * faltarem" do template de formulário). */
  private async ensureNativeColumn(
    user: AuthPrincipal,
    boardId: string,
    field: FormTemplatePayload['fields'][number],
  ): Promise<string> {
    const definition = await this.definitions.load(this.runner.tx, boardId);
    const existing = definition?.columns.find(
      (column) => column.type === field.fieldType && column.title.trim().toLowerCase() === field.label.trim().toLowerCase(),
    );
    if (existing !== undefined) return existing.key;
    const created = await this.columns.create(user, boardId, { type: field.fieldType, title: field.label });
    return created.key;
  }

  /** Insere os itens do snapshot no board recém-criado, remapeando status/dropdown por texto (os ids
   * das escolhas do board de origem não existem mais — `fromTemplate` sempre cria escolhas novas). */
  private async applyBoardItems(user: AuthPrincipal, boardId: string, payload: BoardTemplatePayload): Promise<void> {
    const snapshotItems = payload.items;
    if (snapshotItems === undefined || snapshotItems.length === 0) return;
    const definition = await this.definitions.load(this.runner.tx, boardId);
    if (definition === null) return;
    const columnsByKey = new Map(definition.columns.map((column) => [column.key, column]));
    const groupRows = await this.runner.tx
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt)));
    const groupIdByName = new Map(groupRows.map((row) => [row.name.trim().toLowerCase(), row.id]));
    const fallbackGroupId = groupRows[0]?.id;
    const lastPositionByGroup = new Map<string, string | null>();
    for (const item of snapshotItems.slice(0, TEMPLATE_SNAPSHOT_MAX_ITEMS)) {
      const groupId = groupIdByName.get(item.groupName.trim().toLowerCase()) ?? fallbackGroupId;
      if (groupId === undefined) continue;
      const values: Record<string, Record<string, unknown>> = {};
      for (const [key, raw] of Object.entries(item.values)) {
        const column = columnsByKey.get(key);
        if (column === undefined) continue;
        const resolved = resolveSnapshotValue(column, raw);
        if (resolved !== undefined) values[key] = resolved;
      }
      const position = positionBetween(lastPositionByGroup.get(groupId) ?? null, null);
      lastPositionByGroup.set(groupId, position);
      await this.runner.tx.insert(items).values({
        tenantId: user.tenantId,
        boardId,
        groupId,
        name: item.name,
        values,
        position,
        createdBy: user.userId,
      });
    }
  }

  // ---------------------------------------------------------------------- salvar como template ---

  /** Snapshot do board atual (grupos + colunas + opcionalmente itens) → nova linha `templates` do
   * tenant chamador. É uma fotografia: mudanças futuras no board nunca afetam o template salvo. */
  async saveBoardAsTemplate(
    user: AuthPrincipal,
    boardId: string,
    input: SaveBoardAsTemplateInput,
  ): Promise<TemplateDto> {
    await this.access.assert(user, 'board.manage', { type: 'board', id: boardId }, 'Board');
    const [board] = await this.runner.tx
      .select({ name: boards.name, description: boards.description, icon: boards.icon, settings: boards.settings })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');
    const definition = await this.definitions.load(this.runner.tx, boardId);
    if (definition === null) throw new NotFoundError('Board');
    const columnsByKey = new Map(definition.columns.map((column) => [column.key, column]));

    const groupRows = await this.runner.tx
      .select({ id: groups.id, name: groups.name, color: groups.color })
      .from(groups)
      .where(and(eq(groups.boardId, boardId), isNull(groups.deletedAt), isNull(groups.archivedAt)))
      .orderBy(asc(groups.position));
    const [defaultView] = await this.runner.tx
      .select({ name: views.name })
      .from(views)
      .where(and(eq(views.boardId, boardId), eq(views.isDefault, true), isNull(views.deletedAt)));

    const payload: BoardTemplatePayload = {
      name: input.name,
      description: input.description ?? board.description ?? '',
      icon: board.icon ?? 'layout-grid',
      groups: groupRows.map((row) => ({ name: row.name, color: row.color })),
      columns: definition.columns.map((column) => ({
        key: column.key,
        type: column.type,
        title: column.title,
        ...(column.width === null ? {} : { width: column.width }),
        ...(column.binding === null ? {} : { binding: column.binding }),
        settings: column.settings,
        ...(column.description === null ? {} : { description: column.description }),
        labels: column.labels.map((label) => ({ label: label.label, color: label.color, category: label.category })),
        options: column.options.map((option) => ({ label: option.label, color: option.color ?? '#579bfc' })),
        isRequired: column.isRequired,
        ...(extractRequiredWhenLabel(column.requiredWhen, columnsByKey) === undefined
          ? {}
          : { requiredWhenLabel: extractRequiredWhenLabel(column.requiredWhen, columnsByKey) }),
      })),
      statusColumnKey:
        typeof board.settings.statusColumnKey === 'string' ? board.settings.statusColumnKey : (definition.columns.find((c) => c.type === 'status')?.key ?? ''),
      viewName: defaultView?.name ?? 'Tabela principal',
    };
    if (input.includeItems) {
      const itemRows = await this.runner.tx
        .select({ groupId: items.groupId, name: items.name, values: items.values })
        .from(items)
        .where(and(eq(items.boardId, boardId), isNull(items.deletedAt), isNull(items.archivedAt), sql`${items.parentItemId} is null`))
        .orderBy(asc(items.position))
        .limit(TEMPLATE_SNAPSHOT_MAX_ITEMS);
      const groupNameById = new Map(groupRows.map((row) => [row.id, row.name]));
      payload.items = itemRows.flatMap((row) => {
        const groupName = groupNameById.get(row.groupId);
        if (groupName === undefined) return [];
        const values: Record<string, unknown> = {};
        for (const [key, raw] of Object.entries(row.values)) {
          const column = columnsByKey.get(key);
          if (column === undefined) continue;
          const snapshot = snapshotValue(column, raw);
          if (snapshot !== undefined) values[key] = snapshot;
        }
        return [{ groupName, name: row.name, values }];
      });
    }

    const validated = parsePayload('board', payload);
    const [row] = await this.runner.tx
      .insert(templates)
      .values({
        tenantId: user.tenantId,
        kind: 'board',
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        payload: validated as Record<string, unknown>,
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao salvar template');
    this.events.recordChange({
      action: 'template.created',
      entityType: 'template',
      entityId: row.id,
      boardId,
      after: { kind: 'board', name: row.name, fromBoard: boardId },
    });
    await this.emitChanged(user, row.id, 'board', 'created');
    return toDto(row);
  }

  // ------------------------------------------------------------------------------ internos ---

  private async findReadable(user: AuthPrincipal, id: string): Promise<TemplateRow> {
    const [row] = await this.runner.tx
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, id),
          isNull(templates.deletedAt),
          or(isNull(templates.tenantId), eq(templates.tenantId, user.tenantId)),
        ),
      );
    if (row === undefined) throw new NotFoundError('Template');
    return row;
  }

  private async findOwn(user: AuthPrincipal, id: string): Promise<TemplateRow> {
    const [row] = await this.runner.tx
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.tenantId, user.tenantId), isNull(templates.deletedAt)));
    if (row === undefined) throw new NotFoundError('Template');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    templateId: string,
    kind: TemplateRow['kind'],
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    // Templates globais (`tenantId` nulo) nunca emitem este evento (ADR 0056) — a galeria pública não
    // muda em tempo real para o usuário comum; `saveBoardAsTemplate`/`create`/`update`/`remove` só
    // operam na galeria do tenant chamador de qualquer forma, então isto é só uma garantia defensiva.
    // `kind` nunca é `item` por esses caminhos (reservado, não implementado — ver `toDto`).
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'template.changed',
      aggregateType: 'template',
      aggregateId: templateId,
      payload: { templateId, kind: kind as TemplateKind, change },
      actorId: user.userId,
    });
  }
}
