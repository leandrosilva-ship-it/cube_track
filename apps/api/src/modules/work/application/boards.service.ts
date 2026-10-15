import { Injectable } from '@nestjs/common';
import { outboxRowToMessage, schema } from '@cube-track/db';
import type { RealtimeEvent } from '@cube-track/shared';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { redactEventFor } from '../domain/event-redaction.js';
import { ItemsService } from './items.service.js';

const {
  workspaces,
  boards,
  groups,
  columnDefinitions,
  statusLabels,
  dropdownOptions,
  outboxEvents,
} = schema;

const REPLAY_LIMIT = 500;

/** Leitura de workspaces/boards (filtrada por permissão) e administração de colunas. */
@Injectable()
export class BoardsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly items: ItemsService,
  ) {}

  async listWorkspaces(user: AuthPrincipal) {
    const rows = await this.runner.tx
      .select({
        id: workspaces.id,
        name: workspaces.name,
        description: workspaces.description,
        icon: workspaces.icon,
        color: workspaces.color,
        visibility: workspaces.visibility,
        enabledModules: workspaces.enabledModules,
      })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt))
      .orderBy(asc(workspaces.position));
    // Convidados sem leitura do workspace ainda o enxergam se tiverem algum board concedido nele.
    const boardWorkspaces = new Set(
      (await this.access.readableBoards(user)).map((board) => board.workspaceId),
    );
    const visible = await Promise.all(
      rows.map(async (row) =>
        boardWorkspaces.has(row.id) || (await this.access.workspace(user, row.id)) !== null
          ? row
          : null,
      ),
    );
    return visible.filter((row) => row !== null);
  }

  async listBoards(user: AuthPrincipal, workspaceId: string) {
    await this.access.assert(
      user,
      'workspace.read',
      { type: 'workspace', id: workspaceId },
      'Workspace',
    );
    const rows = await this.runner.tx
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        folderId: boards.folderId,
        kind: boards.kind,
        name: boards.name,
        description: boards.description,
        visibility: boards.visibility,
        isTemplate: boards.isTemplate,
      })
      .from(boards)
      .where(
        and(
          eq(boards.workspaceId, workspaceId),
          isNull(boards.deletedAt),
          isNull(boards.archivedAt),
        ),
      )
      .orderBy(asc(boards.position));
    const visible = await Promise.all(
      rows.map(async (row) => ((await this.access.board(user, row.id)) === null ? null : row)),
    );
    return visible.filter((row) => row !== null);
  }

  async getBoard(user: AuthPrincipal, boardId: string) {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const [board] = await tx
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        folderId: boards.folderId,
        kind: boards.kind,
        name: boards.name,
        description: boards.description,
        icon: boards.icon,
        visibility: boards.visibility,
        terminology: boards.terminology,
        settings: boards.settings,
        isTemplate: boards.isTemplate,
        seq: boards.seq,
      })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');
    const access = await this.access.board(user, boardId);
    const visibility = await this.items.visibility(user, boardId);
    const visibleColumns = visibility.columns.filter(
      (column) => !visibility.hidden.has(column.key),
    );
    const columnIds = visibleColumns.map((column) => column.id);
    const [groupRows, columnRows, labelRows, optionRows] = await Promise.all([
      tx
        .select({
          id: groups.id,
          name: groups.name,
          color: groups.color,
          position: groups.position,
          isCollapsed: groups.isCollapsed,
        })
        .from(groups)
        .where(
          and(eq(groups.boardId, boardId), isNull(groups.deletedAt), isNull(groups.archivedAt)),
        )
        .orderBy(asc(groups.position)),
      columnIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              id: columnDefinitions.id,
              key: columnDefinitions.key,
              type: columnDefinitions.type,
              title: columnDefinitions.title,
              description: columnDefinitions.description,
              settings: columnDefinitions.settings,
              binding: columnDefinitions.binding,
              isRequired: columnDefinitions.isRequired,
              requiredWhen: columnDefinitions.requiredWhen,
              defaultValue: columnDefinitions.defaultValue,
              isHidden: columnDefinitions.isHidden,
              position: columnDefinitions.position,
              width: columnDefinitions.width,
              permissions: columnDefinitions.permissions,
            })
            .from(columnDefinitions)
            .where(inArray(columnDefinitions.id, columnIds))
            .orderBy(asc(columnDefinitions.position)),
      columnIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              id: statusLabels.id,
              columnId: statusLabels.columnId,
              label: statusLabels.label,
              color: statusLabels.color,
              category: statusLabels.category,
              position: statusLabels.position,
            })
            .from(statusLabels)
            .where(and(inArray(statusLabels.columnId, columnIds), isNull(statusLabels.deletedAt)))
            .orderBy(asc(statusLabels.position)),
      columnIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              id: dropdownOptions.id,
              columnId: dropdownOptions.columnId,
              label: dropdownOptions.label,
              color: dropdownOptions.color,
              position: dropdownOptions.position,
            })
            .from(dropdownOptions)
            .where(
              and(inArray(dropdownOptions.columnId, columnIds), isNull(dropdownOptions.deletedAt)),
            )
            .orderBy(asc(dropdownOptions.position)),
    ]);
    const canEdit = await Promise.all(
      columnRows.map((column) =>
        this.access.can(user, 'column.update', { type: 'column', boardId, key: column.key }),
      ),
    );
    return {
      ...board,
      groups: groupRows,
      columns: columnRows.map((column, index) => ({
        ...column,
        canEdit: canEdit[index] ?? false,
        labels: labelRows.filter((label) => label.columnId === column.id),
        options: optionRows.filter((option) => option.columnId === column.id),
      })),
      permissions: [...(access?.permissions ?? [])],
      itemScope: access?.itemScope ?? 'all',
    };
  }

  /** Replay de eventos do board após `afterSeq` (reconexão), já redigidos para o usuário. */
  async replay(
    user: AuthPrincipal,
    boardId: string,
    afterSeq: number,
  ): Promise<{ events: RealtimeEvent[]; resyncRequired: boolean; seq: number }> {
    await this.access.assert(user, 'board.read', { type: 'board', id: boardId }, 'Board');
    const tx = this.runner.tx;
    const [board] = await tx.select({ seq: boards.seq }).from(boards).where(eq(boards.id, boardId));
    const current = board?.seq ?? 0;
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(and(eq(outboxEvents.boardId, boardId), gt(outboxEvents.seq, afterSeq)))
      .orderBy(asc(outboxEvents.seq))
      .limit(REPLAY_LIMIT + 1);
    const contiguous = rows.length === 0 ? current === afterSeq : rows[0]?.seq === afterSeq + 1;
    if (!contiguous || rows.length > REPLAY_LIMIT)
      return { events: [], resyncRequired: true, seq: current };
    const principal = await this.access.principal(user);
    const access = await this.access.board(user, boardId);
    const visibility = await this.items.visibility(user, boardId);
    return {
      events: rows.map((row) =>
        redactEventFor(outboxRowToMessage(row), principal, access, visibility),
      ),
      resyncRequired: false,
      seq: current,
    };
  }
}
