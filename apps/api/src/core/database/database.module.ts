import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type DatabaseHandle } from '@cube-track/db';

import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { EventPublisher } from '../events/event-publisher.js';
import { APP_DB, AUTH_DB } from './tokens.js';
import { TransactionRunner } from './transaction-runner.js';

export { APP_DB, AUTH_DB } from './tokens.js';

@Global()
@Module({
  providers: [
    {
      provide: APP_DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createDatabase(config.DATABASE_APP_URL, {
          max: config.DATABASE_POOL_MAX,
          application_name: 'cube-track-api',
        }),
    },
    {
      provide: AUTH_DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createDatabase(config.DATABASE_AUTH_URL, { max: 5, application_name: 'cube-track-auth' }),
    },
    EventPublisher,
    TransactionRunner,
  ],
  exports: [APP_DB, AUTH_DB, EventPublisher, TransactionRunner],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(APP_DB) private readonly appDb: DatabaseHandle,
    @Inject(AUTH_DB) private readonly authDb: DatabaseHandle,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.appDb.close(), this.authDb.close()]);
  }
}
