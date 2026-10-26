import type { Server } from 'node:http';

import { S3Client } from '@aws-sdk/client-s3';
import { createDatabase } from '@cube-track/db';
import { QUEUES } from '@cube-track/shared';
import type { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { MeiliSearch } from 'meilisearch';

import { createBoardApp, listen } from './board.js';
import type { WorkerConfig } from './config.js';
import type { Logger } from './logger.js';
import { OutboxRelay } from './outbox-relay.js';
import { automationsProcessor } from './processors/automations.js';
import { computedProcessor } from './processors/computed.js';
import { createMailer, emailProcessor } from './processors/email.js';
import { fileScanProcessor } from './processors/file-scan.js';
import { maintenanceProcessor, scheduleMaintenance } from './processors/maintenance.js';
import { notificationsProcessor } from './processors/notifications.js';
import { scheduleProcessor } from './processors/schedule.js';
import { createSlaCheck } from './processors/sla.js';
import { ensureSearchIndexes, searchIndexProcessor } from './processors/search-index.js';
import { webhookDeliveryProcessor, webhookFanoutProcessor } from './processors/webhooks.js';
import { createQueues, createWorker, type QueueRegistry } from './queues.js';
import { ClamdScanner, DisabledScanner } from './scanner.js';

export interface RunningWorker {
  queues: QueueRegistry;
  relay: OutboxRelay;
  server: Server;
  stop: () => Promise<void>;
}

/** Monta o worker: relay do outbox, consumidores de todas as filas e o painel HTTP. */
export async function startWorker(config: WorkerConfig, logger: Logger): Promise<RunningWorker> {
  const appDb = createDatabase(config.DATABASE_APP_URL);
  const relayDb = createDatabase(config.DATABASE_RELAY_URL, { max: 2 });
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const queues = createQueues(config.REDIS_URL);
  const meili = new MeiliSearch({ host: config.MEILI_URL, apiKey: config.MEILI_API_KEY });
  await ensureSearchIndexes(meili).catch((error: unknown) => {
    logger.warn(
      { err: error },
      'Meilisearch indisponível na inicialização; índices serão criados na próxima execução',
    );
  });
  const s3 = new S3Client({
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    ...(config.S3_ENDPOINT === undefined ? {} : { endpoint: config.S3_ENDPOINT }),
  });
  const scanner =
    config.ANTIVIRUS_MODE === 'clamd'
      ? new ClamdScanner(config.CLAMD_HOST, config.CLAMD_PORT)
      : new DisabledScanner();
  const common = {
    redisUrl: config.REDIS_URL,
    concurrency: config.WORKER_CONCURRENCY,
    deadLetter: queues[QUEUES.deadLetter],
    logger,
  };
  const automations = automationsProcessor({ database: appDb, redis, logger });
  const checkSla = createSlaCheck({ database: appDb, redis, logger });

  const workers: Worker[] = [
    createWorker(
      QUEUES.emails,
      emailProcessor(createMailer(config.SMTP_URL), config.EMAIL_FROM),
      common,
    ),
    createWorker(
      QUEUES.notifications,
      notificationsProcessor({
        database: appDb,
        redis,
        emails: queues[QUEUES.emails],
        appUrl: config.APP_URL,
        jwtSecret: config.JWT_SECRET,
        mailReplyDomain: config.MAIL_REPLY_DOMAIN,
      }),
      common,
    ),
    createWorker(QUEUES.automations, automations.processEvent, common),
    // Recálculo de cronograma serializado (concorrência 1) para evitar conflitos no mesmo board.
    createWorker(QUEUES.schedule, scheduleProcessor({ database: appDb, redis }), {
      ...common,
      concurrency: 1,
    }),
    createWorker(QUEUES.searchIndex, searchIndexProcessor({ database: appDb, meili }), common),
    // Colunas calculadas entre itens: serializado por simplicidade de ordem (ADR 0038).
    createWorker(QUEUES.computed, computedProcessor({ database: appDb, redis }), {
      ...common,
      concurrency: 1,
    }),
    createWorker(
      QUEUES.maintenance,
      maintenanceProcessor({
        database: appDb,
        computedQueue: queues[QUEUES.computed],
        logger,
        checkDateArrives: automations.checkDateArrives,
        checkSla,
      }),
      { ...common, concurrency: 1 },
    ),
    createWorker(
      QUEUES.fileScan,
      fileScanProcessor({ database: appDb, s3, bucket: config.S3_BUCKET, scanner }),
      {
        ...common,
        concurrency: Math.min(4, config.WORKER_CONCURRENCY),
      },
    ),
    createWorker(
      QUEUES.webhooks,
      webhookFanoutProcessor({
        database: appDb,
        deliveryQueue: queues[QUEUES.webhookDeliveries],
        logger,
      }),
      common,
    ),
    createWorker(
      QUEUES.webhookDeliveries,
      webhookDeliveryProcessor({ database: appDb, encryptionKey: config.ENCRYPTION_KEY, logger }),
      common,
    ),
  ] as Worker[];

  const relay = new OutboxRelay(relayDb, redis, queues, logger, {
    pollMs: config.OUTBOX_POLL_MS,
    batchSize: config.OUTBOX_BATCH_SIZE,
    retentionDays: config.OUTBOX_RETENTION_DAYS,
  });
  relay.start();
  await scheduleMaintenance(queues[QUEUES.maintenance]);

  const credentials =
    config.BULL_BOARD_USER !== undefined && config.BULL_BOARD_PASSWORD !== undefined
      ? { user: config.BULL_BOARD_USER, password: config.BULL_BOARD_PASSWORD }
      : null;
  if (credentials === null)
    logger.warn('BULL_BOARD_USER/BULL_BOARD_PASSWORD ausentes: painel de filas desativado');
  const app = createBoardApp({
    queues,
    credentials,
    ready: async () => {
      await appDb.pool.query('select 1');
      await redis.ping();
      return true;
    },
  });
  const server = await listen(app, config.BOARD_PORT);
  logger.info({ port: config.BOARD_PORT }, 'Worker iniciado');

  const stop = async () => {
    relay.stop();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all(Object.values(queues).map((queue) => queue.close()));
    redis.disconnect();
    s3.destroy();
    await Promise.all([appDb.close(), relayDb.close()]);
  };
  return { queues, relay, server, stop };
}
