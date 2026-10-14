import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config/config.js';

/** Cliente Redis principal (cache, rate limit, idempotência, presença, publish). */
export const REDIS = Symbol('REDIS');
/** Cliente dedicado a SUBSCRIBE (uma conexão em modo subscriber não executa outros comandos). */
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');

const createClient = (config: AppConfig, name: string) =>
  new Redis(config.REDIS_URL, {
    connectionName: name,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
  });

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createClient(config, 'cube-api'),
    },
    {
      provide: REDIS_SUBSCRIBER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createClient(config, 'cube-api-sub'),
    },
  ],
  exports: [REDIS, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.redis.quit(), this.subscriber.quit()]);
  }
}
