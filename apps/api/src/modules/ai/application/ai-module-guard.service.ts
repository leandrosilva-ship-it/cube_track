import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { eq } from 'drizzle-orm';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError } from '../../../core/errors/problems.js';
import { assertModuleEnabled } from '../../../core/modules/assert-module-enabled.js';

const { boards, items, workspaces } = schema;

/**
 * Checa o módulo opcional `ai` do WORKSPACE (não confundir com `ai_settings`, que é por tenant —
 * ver `AiUsageGuard`). Todo endpoint de IA por board/item passa por aqui antes de checar permissão
 * fina ou chamar o provedor: workspace sem o módulo `ai` responde 404, como qualquer outro módulo
 * opcional (ADR 0017).
 */
@Injectable()
export class AiModuleGuard {
  constructor(private readonly runner: TransactionRunner) {}

  async assertBoardEnabled(boardId: string): Promise<{ workspaceId: string; enabledModules: string[] }> {
    const [board] = await this.runner.tx
      .select({ workspaceId: boards.workspaceId })
      .from(boards)
      .where(eq(boards.id, boardId));
    if (board === undefined) throw new NotFoundError('Board');
    return { workspaceId: board.workspaceId, enabledModules: await this.assertWorkspaceEnabled(board.workspaceId) };
  }

  async assertItemEnabled(
    itemId: string,
  ): Promise<{ boardId: string; workspaceId: string; enabledModules: string[] }> {
    const [item] = await this.runner.tx.select({ boardId: items.boardId }).from(items).where(eq(items.id, itemId));
    if (item === undefined) throw new NotFoundError('Item');
    const { workspaceId, enabledModules } = await this.assertBoardEnabled(item.boardId);
    return { boardId: item.boardId, workspaceId, enabledModules };
  }

  async assertWorkspaceEnabled(workspaceId: string): Promise<string[]> {
    const [workspace] = await this.runner.tx
      .select({ enabledModules: workspaces.enabledModules })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (workspace === undefined) throw new NotFoundError('Workspace');
    assertModuleEnabled(workspace.enabledModules, 'ai');
    return workspace.enabledModules;
  }
}
