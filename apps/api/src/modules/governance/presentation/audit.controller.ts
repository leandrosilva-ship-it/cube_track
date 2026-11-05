import { Controller, Get, Res } from '@nestjs/common';
import type { AuditSearchFilter } from '@cube-track/shared';
import type { Response } from 'express';
import { z } from 'zod';

import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { AuditService } from '../application/audit.service.js';
import * as S from './audit.schemas.js';

function toFilter(query: {
  from?: string | undefined;
  to?: string | undefined;
  actorId?: string | undefined;
  actorKind?: AuditSearchFilter['actorKind'] | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  search?: string | undefined;
}): AuditSearchFilter {
  return {
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
    ...(query.actorKind === undefined ? {} : { actorKind: query.actorKind }),
    ...(query.action === undefined ? {} : { action: query.action }),
    ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
    ...(query.entityId === undefined ? {} : { entityId: query.entityId }),
    ...(query.search === undefined ? {} : { search: query.search }),
  };
}

/** Busca e exportação avançada de auditoria (ADR 0057, LGPD: prestação de contas/accountability). */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('entries')
  @Endpoint({
    summary: 'Buscar entradas de auditoria (filtros + paginação por cursor)',
    description: 'Requer `audit.read`.',
    tags: ['audit'],
    query: S.AuditSearchQuery,
    response: S.AuditSearchResponse,
  })
  search(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.AuditSearchQuery>,
  ) {
    return this.audit.search(user, toFilter(query), query.limit, query.cursor);
  }

  @Get('entries/export')
  @Endpoint({
    summary: 'Exportar entradas de auditoria (CSV ou NDJSON, em stream)',
    description:
      'Requer `audit.export`. Escrita direto na resposta HTTP linha a linha — nunca materializa o resultado inteiro em memória, qualquer que seja o volume.',
    tags: ['audit'],
    query: S.AuditExportQuery,
  })
  async export(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('query') query: z.infer<typeof S.AuditExportQuery>,
    @Res() response: Response,
  ): Promise<void> {
    const extension = query.format === 'csv' ? 'csv' : 'ndjson';
    response.setHeader(
      'content-type',
      query.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson',
    );
    response.setHeader('content-disposition', `attachment; filename="audit-export.${extension}"`);
    await this.audit.streamExport(user, toFilter(query), query.format, (chunk) => response.write(chunk));
    response.end();
  }
}
