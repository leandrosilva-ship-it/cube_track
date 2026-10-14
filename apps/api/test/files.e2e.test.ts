import { createHash } from 'node:crypto';

import { QUEUES } from '@cube-track/shared';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  adminDb,
  client,
  demoIds,
  resetRateLimits,
  startApi,
  USERS,
  type ApiClient,
  type ApiServer,
} from './helpers.js';

describe('Arquivos: upload pré-assinado, validação e antivírus plugável', () => {
  let server: ApiServer;
  let api: ApiClient;
  let token: string;
  let boardId: string;
  let itemId: string;
  const db = adminDb();
  let scans: Queue;

  beforeAll(async () => {
    await resetRateLimits();
    server = await startApi();
    api = client(server.url);
    token = await api.login(USERS.juliana);
    ({ boardId } = await demoIds(api, token));
    const items = await api.get<{ data: { id: string }[] }>(`/v1/boards/${boardId}/items?limit=1`, {
      token,
    });
    itemId = items.body.data[0]?.id ?? '';
    const url = new URL(process.env.REDIS_URL ?? '');
    scans = new Queue(QUEUES.fileScan, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        db: Number(url.pathname.slice(1) || 0),
      },
    });
  });

  afterAll(async () => {
    await scans.close();
    await db.close();
    await server.close();
  });

  it('envia direto ao storage, confirma e só libera download após a varredura', async () => {
    const content = Buffer.from('%PDF-1.7\nTermo de recebimento de teste\n');
    const checksum = createHash('sha256').update(content).digest('hex');
    const requested = await api.post<{
      attachmentId: string;
      versionId: string;
      upload: { url: string; headers: Record<string, string> };
    }>('/v1/files/uploads', {
      token,
      body: {
        boardId,
        itemId,
        fileName: 'termo.pdf',
        mimeType: 'application/pdf',
        sizeBytes: content.length,
        checksumSha256: checksum,
      },
    });
    expect(requested.status).toBe(201);
    const { attachmentId, versionId, upload } = requested.body;

    const early = await api.post<{ code: string }>(
      `/v1/files/${attachmentId}/versions/${versionId}/complete`,
      { token },
    );
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('upload_missing');

    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: { ...upload.headers, 'content-length': String(content.length) },
      body: content,
    });
    expect(put.status).toBe(200);
    const completed = await api.post<{ scanStatus: string }>(
      `/v1/files/${attachmentId}/versions/${versionId}/complete`,
      { token },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.scanStatus).toBe('pending');
    const job = await scans.getJob(`scan-${versionId}`);
    expect(job?.data).toMatchObject({ attachmentId, versionId });

    const pending = await api.get<{ code: string }>(`/v1/files/${attachmentId}/download-url`, {
      token,
    });
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe('scan_pending');

    await db.db.execute(
      sql`update attachment_versions set scan_status = 'clean' where id = ${versionId}::uuid`,
    );
    const download = await api.get<{ url: string }>(`/v1/files/${attachmentId}/download-url`, {
      token,
    });
    expect(download.status).toBe(200);
    const file = await fetch(download.body.url);
    expect(Buffer.from(await file.arrayBuffer())).toEqual(content);

    const listed = await api.get<{ data: { id: string; scanStatus: string }[] }>(
      `/v1/items/${itemId}/files`,
      { token },
    );
    expect(listed.body.data.find((entry) => entry.id === attachmentId)?.scanStatus).toBe('clean');
  });

  it('rejeita tipos, extensões e tamanhos fora da política', async () => {
    const base = {
      boardId,
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      checksumSha256: 'a'.repeat(64),
    };
    expect(
      (
        await api.post('/v1/files/uploads', {
          token,
          body: { ...base, fileName: 'malware.exe', mimeType: 'application/x-msdownload' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await api.post('/v1/files/uploads', { token, body: { ...base, fileName: 'disfarce.exe' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await api.post('/v1/files/uploads', {
          token,
          body: { ...base, sizeBytes: 50 * 1024 * 1024 },
        })
      ).status,
    ).toBe(413);
    const viewer = await api.login(USERS.thiago);
    expect((await api.post('/v1/files/uploads', { token: viewer, body: base })).status).toBe(403);
  });

  it('arquivo infectado nunca é liberado', async () => {
    const requested = await api.post<{ attachmentId: string; versionId: string }>(
      '/v1/files/uploads',
      {
        token,
        body: {
          boardId,
          fileName: 'planilha.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sizeBytes: 3,
          checksumSha256: 'b'.repeat(64),
        },
      },
    );
    await db.db.execute(
      sql`update attachment_versions set scan_status = 'infected' where id = ${requested.body.versionId}::uuid`,
    );
    const blocked = await api.get<{ code: string }>(
      `/v1/files/${requested.body.attachmentId}/download-url`,
      { token },
    );
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('file_blocked');
  });
});
