import { Controller, Get, Patch, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../../core/audit/audited.js';
import { CurrentPrincipal } from '../../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { Endpoint, Input } from '../../../core/http/endpoint.js';
import { ImportsService } from '../application/imports.service.js';
import * as S from './schemas.js';

/** Upload (prévia) de um export do Monday/Trello/Jira/Pipefy/CSV — requer `item.create` no board. */
@Controller('boards/:boardId/imports')
export class BoardImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('preview')
  @Audited({ action: 'import_job.preview', entityType: 'import_job' })
  @Endpoint({
    summary: 'Enviar um export (Monday/Trello/Jira/Pipefy/CSV) e pré-visualizar o mapeamento sugerido',
    description:
      'Requer `item.create` no board. Não cria nada ainda — o commit roda em background depois de ' +
      'ajustar o mapeamento (`PATCH /v1/imports/:importJobId/mapping`) e confirmar ' +
      '(`POST /v1/imports/:importJobId/commit`).',
    tags: ['imports'],
    status: 201,
    params: S.BoardIdParams,
    body: S.PreviewBody,
    response: S.PreviewResponse,
    errors: [413, 422],
  })
  preview(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.BoardIdParams>,
    @Input('body') body: z.infer<typeof S.PreviewBody>,
  ) {
    return this.imports.preview(user, params.boardId, body);
  }
}

/** Ajuste de mapeamento, confirmação (commit em background) e status de um job de importação. */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get(':importJobId')
  @Endpoint({
    summary: 'Status do job de importação',
    description:
      'Quem iniciou a importação sempre pode ver; qualquer outra pessoa precisa de `item.create` no ' +
      'board de destino. Uma vez `completed`/`failed`, traz `createdCount`/`skippedCount`/`errorReport`.',
    tags: ['imports'],
    params: S.ImportJobIdParams,
    response: S.ImportJobSchema,
  })
  get(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ImportJobIdParams>,
  ) {
    return this.imports.get(user, params.importJobId);
  }

  @Patch(':importJobId/mapping')
  @Audited({ action: 'import_job.update_mapping', entityType: 'import_job' })
  @Endpoint({
    summary: 'Ajustar o mapeamento sugerido antes de confirmar',
    description: 'Só quem iniciou a importação, e só enquanto o status ainda é `uploaded`.',
    tags: ['imports'],
    params: S.ImportJobIdParams,
    body: S.UpdateMappingBody,
    response: S.ImportJobSchema,
    errors: [409],
  })
  updateMapping(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ImportJobIdParams>,
    @Input('body') body: z.infer<typeof S.UpdateMappingBody>,
  ) {
    return this.imports.updateMapping(user, params.importJobId, body.mapping);
  }

  @Post(':importJobId/commit')
  @Audited({ action: 'import_job.commit', entityType: 'import_job' })
  @Endpoint({
    summary: 'Confirmar a importação (processa em background)',
    description:
      'Muda o status para `processing` e enfileira o commit no worker — responde imediatamente (não ' +
      'espera o processamento). Acompanhe com `GET /v1/imports/:importJobId` ou pelo evento realtime ' +
      '`import_job.changed`. Só quem iniciou a importação, e só enquanto o status ainda é `uploaded`.',
    tags: ['imports'],
    status: 200,
    params: S.ImportJobIdParams,
    response: S.ImportJobSchema,
    errors: [409],
  })
  commit(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof S.ImportJobIdParams>,
  ) {
    return this.imports.commit(user, params.importJobId);
  }
}
