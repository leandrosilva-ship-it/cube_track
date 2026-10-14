import { Inject, Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { newId, QUEUES, type FileScanJob } from '@cube-track/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../../core/config/config.js';
import { currentContext, type AuthPrincipal } from '../../core/context/request-context.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnprocessableError,
  ValidationError,
} from '../../core/errors/problems.js';
import { DomainEvents } from '../../core/events/domain-events.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../../core/queues/queues.module.js';
import { AccessService } from '../access/application/access.service.js';
import { ItemsRepository } from '../work/infrastructure/items.repository.js';
import { checkFile } from './file-policy.js';
import { StorageService } from './storage.service.js';

const { attachments, attachmentVersions } = schema;

export interface UploadRequest {
  boardId: string;
  itemId?: string | undefined;
  attachmentId?: string | undefined;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

/**
 * Upload direto ao object storage por URL pré-assinada: a API valida permissão, tipo e tamanho,
 * registra a versão como `pending` e, após a confirmação, enfileira a varredura antivírus (worker).
 * Download só é liberado para versões `clean`.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    private readonly runner: TransactionRunner,
    private readonly storage: StorageService,
    private readonly access: AccessService,
    private readonly items: ItemsRepository,
    private readonly events: DomainEvents,
  ) {}

  async requestUpload(user: AuthPrincipal, input: UploadRequest) {
    await this.access.assert(user, 'file.upload', { type: 'board', id: input.boardId }, 'Board');
    const check = checkFile(
      input.fileName,
      input.mimeType,
      input.sizeBytes,
      this.config.UPLOAD_MAX_BYTES,
    );
    if (!check.ok) {
      if (input.sizeBytes > this.config.UPLOAD_MAX_BYTES)
        throw new PayloadTooLargeError(check.reason ?? 'Arquivo muito grande.');
      throw new ValidationError([
        { path: 'body.fileName', message: check.reason ?? 'Arquivo inválido.' },
      ]);
    }
    const tx = this.runner.tx;
    if (input.itemId !== undefined) {
      const item = await this.items.findById(tx, input.itemId);
      if (item?.boardId !== input.boardId)
        throw new ValidationError([
          { path: 'body.itemId', message: 'Item não pertence ao board.' },
        ]);
      await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    }
    let attachmentId = input.attachmentId;
    let version = 1;
    if (attachmentId === undefined) {
      attachmentId = newId();
      await tx.insert(attachments).values({
        id: attachmentId,
        tenantId: user.tenantId,
        boardId: input.boardId,
        itemId: input.itemId ?? null,
        fileName: input.fileName,
        currentVersion: 1,
        createdBy: user.userId,
      });
    } else {
      const [existing] = await tx
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.id, attachmentId),
            eq(attachments.boardId, input.boardId),
            isNull(attachments.deletedAt),
          ),
        );
      if (existing === undefined) throw new NotFoundError('Arquivo');
      version = existing.currentVersion + 1;
    }
    const versionId = newId();
    const storageKey = `tenants/${user.tenantId}/boards/${input.boardId}/${attachmentId}/v${version}-${versionId}`;
    await tx.insert(attachmentVersions).values({
      id: versionId,
      tenantId: user.tenantId,
      attachmentId,
      version,
      storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      scanStatus: 'pending',
      createdBy: user.userId,
    });
    this.events.recordChange({
      action: 'file.upload_requested',
      entityType: 'attachment',
      entityId: attachmentId,
      boardId: input.boardId,
      itemId: input.itemId ?? null,
      after: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        version,
      },
    });
    const uploadUrl = await this.storage.presignUpload(storageKey, input.mimeType, input.sizeBytes);
    return {
      attachmentId,
      versionId,
      version,
      upload: {
        url: uploadUrl,
        method: 'PUT' as const,
        headers: { 'content-type': input.mimeType },
      },
      expiresAt: new Date(Date.now() + this.config.UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async completeUpload(user: AuthPrincipal, attachmentId: string, versionId: string) {
    const tx = this.runner.tx;
    const [row] = await tx
      .select({ attachment: attachments, version: attachmentVersions })
      .from(attachmentVersions)
      .innerJoin(attachments, eq(attachments.id, attachmentVersions.attachmentId))
      .where(and(eq(attachmentVersions.id, versionId), eq(attachments.id, attachmentId)));
    if (row === undefined || row.attachment.boardId === null) throw new NotFoundError('Arquivo');
    const boardId = row.attachment.boardId;
    await this.access.assert(user, 'file.upload', { type: 'board', id: boardId }, 'Board');
    const size = await this.storage.objectSize(row.version.storageKey);
    if (size === null)
      throw new ConflictError(
        'O arquivo ainda não foi enviado ao armazenamento.',
        'upload_missing',
      );
    if (size !== row.version.sizeBytes)
      throw new UnprocessableError(
        'O tamanho enviado difere do informado.',
        'upload_size_mismatch',
      );
    await tx
      .update(attachments)
      .set({ currentVersion: row.version.version, fileName: row.attachment.fileName })
      .where(eq(attachments.id, attachmentId));
    this.events.recordChange({
      action: 'file.uploaded',
      entityType: 'attachment',
      entityId: attachmentId,
      boardId,
      itemId: row.attachment.itemId,
      after: { version: row.version.version },
      ...(row.attachment.itemId === null
        ? {}
        : {
            activity: [
              {
                action: 'file.uploaded',
                newValue: { fileName: row.attachment.fileName, version: row.version.version },
              },
            ],
          }),
    });
    const job: FileScanJob = {
      tenantId: user.tenantId,
      attachmentId,
      versionId,
      storageKey: row.version.storageKey,
    };
    currentContext()?.afterCommit.push(async () => {
      await this.queues[QUEUES.fileScan].add('scan', job, { jobId: `scan-${versionId}` });
    });
    return { attachmentId, versionId, scanStatus: row.version.scanStatus };
  }

  async downloadUrl(user: AuthPrincipal, attachmentId: string) {
    const tx = this.runner.tx;
    const [attachment] = await tx
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt)));
    if (attachment === undefined || attachment.boardId === null) throw new NotFoundError('Arquivo');
    if (attachment.itemId !== null) {
      const item = await this.items.findById(tx, attachment.itemId);
      if (item === null) throw new NotFoundError('Arquivo');
      await this.access.assert(user, 'item.read', { type: 'item', item }, 'Arquivo');
    } else {
      await this.access.assert(
        user,
        'board.read',
        { type: 'board', id: attachment.boardId },
        'Arquivo',
      );
    }
    const [version] = await tx
      .select()
      .from(attachmentVersions)
      .where(
        and(
          eq(attachmentVersions.attachmentId, attachmentId),
          eq(attachmentVersions.version, attachment.currentVersion),
        ),
      );
    if (version === undefined) throw new NotFoundError('Arquivo');
    if (version.scanStatus === 'pending')
      throw new ConflictError(
        'O arquivo ainda está sendo verificado pelo antivírus.',
        'scan_pending',
      );
    if (version.scanStatus !== 'clean')
      throw new UnprocessableError(
        'O arquivo foi bloqueado pela verificação de segurança.',
        'file_blocked',
      );
    return {
      url: await this.storage.presignDownload(
        version.storageKey,
        attachment.fileName,
        version.mimeType,
      ),
      expiresInSeconds: 300,
      fileName: attachment.fileName,
      mimeType: version.mimeType,
      sizeBytes: version.sizeBytes,
    };
  }

  async listForItem(user: AuthPrincipal, itemId: string) {
    const tx = this.runner.tx;
    const item = await this.items.findById(tx, itemId);
    if (item === null) throw new NotFoundError('Item');
    await this.access.assert(user, 'item.read', { type: 'item', item }, 'Item');
    const rows = await tx
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        currentVersion: attachments.currentVersion,
        createdAt: attachments.createdAt,
        mimeType: attachmentVersions.mimeType,
        sizeBytes: attachmentVersions.sizeBytes,
        scanStatus: attachmentVersions.scanStatus,
      })
      .from(attachments)
      .innerJoin(
        attachmentVersions,
        and(
          eq(attachmentVersions.attachmentId, attachments.id),
          eq(attachmentVersions.version, attachments.currentVersion),
        ),
      )
      .where(and(eq(attachments.itemId, itemId), isNull(attachments.deletedAt)))
      .orderBy(desc(attachments.createdAt), asc(attachments.fileName));
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }
}
