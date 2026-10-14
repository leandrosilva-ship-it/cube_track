import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

import type { AppConfig } from '../../core/config/config.js';

/** Socket.IO com Redis adapter: broadcasts (presença) chegam a todas as réplicas (ADR 0007). */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter> | undefined;
  private clients: Redis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly config: AppConfig,
  ) {
    super(app);
  }

  async connect(): Promise<void> {
    const pub = new Redis(this.config.REDIS_URL, {
      connectionName: 'cube-io-pub',
      lazyConnect: true,
    });
    const sub = pub.duplicate({ connectionName: 'cube-io-sub' });
    await Promise.all([pub.connect(), sub.connect()]);
    this.clients = [pub, sub];
    this.adapterConstructor = createAdapter(pub, sub, { key: 'cube:io' });
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        origin: this.config.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
        credentials: true,
      },
      pingInterval: 20_000,
      pingTimeout: 20_000,
      maxHttpBufferSize: 64 * 1024,
      connectionStateRecovery: undefined,
    }) as { adapter: (constructor: unknown) => void };
    if (this.adapterConstructor !== undefined) server.adapter(this.adapterConstructor);
    return server;
  }

  override async close(server: unknown): Promise<void> {
    await super.close(server as never);
    await Promise.allSettled(this.clients.map((client) => client.quit()));
  }
}
