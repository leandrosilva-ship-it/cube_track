import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { APP_CONFIG, type AppConfig } from './core/config/config.js';
import { RealtimeAppModule } from './modules/realtime/realtime-app.module.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';

/** Processo dedicado ao gateway WebSocket (REALTIME_MODE=separate, ADR 0007/0027). */
const app = await NestFactory.create(RealtimeAppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
const config = app.get<AppConfig>(APP_CONFIG);
const adapter = new RedisIoAdapter(app, config);
await adapter.connect();
app.useWebSocketAdapter(adapter);
app.enableShutdownHooks();
await app.listen(config.REALTIME_PORT, '0.0.0.0');
