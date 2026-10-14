import { Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';

import { Audited } from '../../core/audit/audited.js';
import { CurrentPrincipal } from '../../core/auth/decorators.js';
import type { AuthPrincipal } from '../../core/context/request-context.js';
import { Endpoint, Input } from '../../core/http/endpoint.js';
import { IdParams } from '../../core/http/schemas.js';
import { FilesService } from './files.service.js';

const UploadBody = z.object({
  boardId: z.uuid(),
  itemId: z.uuid().optional(),
  attachmentId: z.uuid().optional(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().min(3).max(150),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const UploadResponse = z.object({
  attachmentId: z.uuid(),
  versionId: z.uuid(),
  version: z.number().int(),
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
  }),
  expiresAt: z.string(),
});
const CompleteParams = z.object({ id: z.uuid(), versionId: z.uuid() });

@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('files/uploads')
  @Audited({ action: 'file.upload_request', entityType: 'attachment' })
  @Endpoint({
    summary: 'Solicitar URL pré-assinada de upload',
    description:
      'Valida permissão, tipo (lista de permissão) e tamanho; o cliente envia o arquivo com PUT direto ao storage.',
    tags: ['files'],
    status: 201,
    body: UploadBody,
    response: UploadResponse,
    errors: [413],
  })
  requestUpload(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('body') body: z.infer<typeof UploadBody>,
  ) {
    return this.files.requestUpload(user, body);
  }

  @Post('files/:id/versions/:versionId/complete')
  @Audited({ action: 'file.upload_complete', entityType: 'attachment' })
  @Endpoint({
    summary: 'Confirmar upload e enfileirar antivírus',
    tags: ['files'],
    status: 200,
    params: CompleteParams,
    response: z.object({ attachmentId: z.uuid(), versionId: z.uuid(), scanStatus: z.string() }),
    errors: [409],
  })
  complete(
    @CurrentPrincipal() user: AuthPrincipal,
    @Input('params') params: z.infer<typeof CompleteParams>,
  ) {
    return this.files.completeUpload(user, params.id, params.versionId);
  }

  @Get('files/:id/download-url')
  @Endpoint({
    summary: 'URL temporária de download (somente arquivos verificados)',
    tags: ['files'],
    params: IdParams,
    response: z.object({
      url: z.string(),
      expiresInSeconds: z.number(),
      fileName: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
    }),
    errors: [409],
  })
  download(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: { id: string }) {
    return this.files.downloadUrl(user, params.id);
  }

  @Get('items/:id/files')
  @Endpoint({ summary: 'Arquivos do item', tags: ['files'], params: IdParams })
  async list(@CurrentPrincipal() user: AuthPrincipal, @Input('params') params: { id: string }) {
    return { data: await this.files.listForItem(user, params.id) };
  }
}
