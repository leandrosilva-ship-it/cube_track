import {
  DEFAULT_JOB_OPTIONS,
  QUEUES,
  type DeadLetterJob,
  type QueueName,
} from '@cube-track/shared';
import { Queue, Worker, type Job, type Processor } from 'bullmq';

import { redisConnection } from './config.js';
import type { Logger } from './logger.js';

export type QueueRegistry = Record<QueueName, Queue>;

export function createQueues(redisUrl: string): QueueRegistry {
  const connection = redisConnection(redisUrl);
  return Object.fromEntries(
    Object.values(QUEUES).map((name) => [
      name,
      new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    ]),
  ) as QueueRegistry;
}

/**
 * Cria um consumidor com retentativas (política padrão das filas) e dead-letter queue: ao esgotar as
 * tentativas, o job é copiado para a fila `dead-letter` com o motivo da falha (visível no Bull Board).
 */
export function createWorker<T>(
  queue: QueueName,
  processor: Processor<T>,
  options: { redisUrl: string; concurrency: number; deadLetter: Queue; logger: Logger },
): Worker<T> {
  const worker = new Worker<T>(queue, processor, {
    connection: redisConnection(options.redisUrl),
    concurrency: options.concurrency,
  });
  worker.on('failed', (job: Job<T> | undefined, error: Error) => {
    if (job === undefined) return;
    const attempts = job.opts.attempts ?? 1;
    options.logger.warn(
      { queue, jobId: job.id, attempt: job.attemptsMade, err: error },
      'Job falhou',
    );
    if (job.attemptsMade < attempts) return;
    const dead: DeadLetterJob = {
      queue,
      jobId: job.id ?? null,
      name: job.name,
      data: job.data,
      failedReason: error.message,
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    void options.deadLetter
      .add(`${queue}:${job.name}`, dead, {
        removeOnComplete: false,
        removeOnFail: false,
        attempts: 1,
      })
      .catch((dlqError: unknown) => {
        options.logger.error(
          { err: dlqError, queue, jobId: job.id },
          'Falha ao mover job para a dead-letter queue',
        );
      });
  });
  worker.on('error', (error) => {
    options.logger.error({ err: error, queue }, 'Erro no consumidor');
  });
  return worker;
}
