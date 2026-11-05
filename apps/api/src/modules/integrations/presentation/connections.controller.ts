import { Controller, Delete, Get } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { ConnectionsService } from '../application/connections.service.js';
import * as S from './schemas.js';

/** Listagem/desconexão de integrações — comum a todos os provedores (ADR 0056). */
@Controller()
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get('workspaces/:workspaceId/integrations')
  @Endpoint({
    summary: 'Listar conexões de integração do workspace',
    description: 'Requer `integrations.manage`. Nunca retorna segredos/tokens, só metadados seguros.',
    tags: ['integrations'],
    params: S.WorkspaceParams,
    response: z.object({ data: z.array(S.ConnectionSchema) }),
  })
  async list(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.WorkspaceParams>,
  ) {
    return { data: await this.connections.list(user, params.workspaceId) };
  }

  @Delete('integrations/:connectionId')
  @Audited({ action: 'integration_connection.disconnect', entityType: 'integration_connection' })
  @Endpoint({
    summary: 'Desconectar uma integração (exclusão lógica)',
    description: 'Requer `integrations.manage` no workspace dono da conexão.',
    tags: ['integrations'],
    status: 204,
    params: S.ConnectionParams,
  })
  async disconnect(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ConnectionParams>,
  ) {
    await this.connections.disconnect(user, params.connectionId);
  }
}
