import { schema, withTenant, type DatabaseHandle } from '@cube-track/db';
import { eq } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { NotFoundError } from '../../../core/errors/problems.js';

const { integrationConnections } = schema;

/**
 * Quem "age" por trás de uma ação disparada por um webhook público sem sessão (comando de barra do
 * Slack, auto-avanço de status ao mesclar PR, ADR 0056): sempre `integration_connections.createdBy`
 * (coluna padrão de toda tabela do tenant — não precisou de um campo `connectedBy` à parte), com as
 * permissões normais dessa pessoa como teto. Nunca `authKind: 'api_token'`: não há escopos de API aqui,
 * só o RBAC normal de quem conectou a integração (mesmo raciocínio do app OAuth `client_credentials`).
 */
export async function resolveConnectedByUser(
  database: DatabaseHandle,
  connection: { tenantId: string; id: string },
): Promise<string> {
  const [row] = await withTenant(database.db, { tenantId: connection.tenantId, userId: null }, (tx) =>
    tx
      .select({ createdBy: integrationConnections.createdBy })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connection.id)),
  );
  if (row?.createdBy === null || row?.createdBy === undefined)
    throw new NotFoundError('Usuário que conectou a integração');
  return row.createdBy;
}

export function syntheticPrincipal(tenantId: string, userId: string, sessionId: string): AuthPrincipal {
  return { userId, tenantId, sessionId, kind: 'member' };
}
