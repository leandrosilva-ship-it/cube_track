import type { Readable } from 'node:stream';

import { DeleteObjectCommand, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { appendAuditLog, schema, withTenant, type DatabaseHandle } from '@cube-track/db';
import { FileScanJobSchema, type FileScanJob } from '@cube-track/shared';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';

import type { AntivirusScanner } from '../scanner.js';

/** Varredura antivírus de uma versão de arquivo: `clean` libera o download; `infected` remove o objeto. */
export function fileScanProcessor(deps: {
  database: DatabaseHandle;
  s3: S3Client;
  bucket: string;
  scanner: AntivirusScanner;
}) {
  return async (job: Job<FileScanJob>) => {
    const data = FileScanJobSchema.parse(job.data);
    const object = await deps.s3.send(
      new GetObjectCommand({ Bucket: deps.bucket, Key: data.storageKey }),
    );
    if (object.Body === undefined) throw new Error('Objeto vazio no storage');
    const verdict = await deps.scanner.scan(object.Body as Readable);
    if (!verdict.clean)
      await deps.s3.send(new DeleteObjectCommand({ Bucket: deps.bucket, Key: data.storageKey }));
    await withTenant(deps.database.db, { tenantId: data.tenantId }, async (tx) => {
      await tx
        .update(schema.attachmentVersions)
        .set({ scanStatus: verdict.clean ? 'clean' : 'infected' })
        .where(eq(schema.attachmentVersions.id, data.versionId));
      await appendAuditLog(tx, {
        tenantId: data.tenantId,
        actorKind: 'system',
        action: verdict.clean ? 'file.scan_clean' : 'file.scan_infected',
        entityType: 'attachment',
        entityId: data.attachmentId,
        after: verdict.clean
          ? { versionId: data.versionId }
          : { versionId: data.versionId, signature: verdict.signature },
        metadata: { scanner: deps.scanner.name },
      });
    });
    return verdict;
  };
}
