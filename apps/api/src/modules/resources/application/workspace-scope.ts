import { schema, type Transaction } from '@cube-track/db';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { NotFoundError } from '../../../core/errors/problems.js';

const { workspaces } = schema;

/**
 * Perfis de recurso, skills, timesheet e capacidade são conceitos de **tenant** (sem `workspaceId`
 * próprio), mas `resources.manage`/`timesheet.approve` são permissões de **workspace** (ADR 0052) —
 * este produto assume, nesta entrega, um workspace principal por tenant (o mais antigo não excluído
 * nem arquivado), e a permissão é checada ali. Um tenant com múltiplos workspaces reais precisaria de
 * uma UI para escolher "qual workspace administra recursos" — fora de escopo até existir esse caso.
 */
export async function primaryWorkspaceId(tx: Transaction, tenantId: string): Promise<string> {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.tenantId, tenantId), isNull(workspaces.deletedAt), isNull(workspaces.archivedAt)))
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  if (workspace === undefined) throw new NotFoundError('Workspace');
  return workspace.id;
}
