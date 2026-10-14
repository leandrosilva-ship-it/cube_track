import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { DEFAULT_JOB_OPTIONS, QUEUES, type QueueName } from '@cube-track/shared';
import { Queue } from 'bullmq';

import { APP_CONFIG, type AppConfig } from '../config/config.js';

export const QUEUE_REGISTRY = Symbol('QUEUE_REGISTRY');
export type QueueRegistry = Record<QueueName, Queue>;

/** Produtores BullMQ (o consumo fica no apps/worker). */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_REGISTRY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): QueueRegistry => {
        const url = new URL(config.REDIS_URL);
        const connection = {
          host: url.hostname,
          port: Number(url.port || 6379),
          db: Number(url.pathname.slice(1) || 0),
          ...(url.password === '' ? {} : { password: decodeURIComponent(url.password) }),
        };
        return Object.fromEntries(
          Object.values(QUEUES).map((name) => [
            name,
            new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
          ]),
        ) as QueueRegistry;
      },
    },
  ],
  exports: [QUEUE_REGISTRY],
})
export class QueuesModule implements OnApplicationShutdown {
  constructor(@Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }
}
