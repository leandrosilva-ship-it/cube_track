import 'reflect-metadata';

import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './core/config/config.js';
import { buildOpenApiDocument } from './openapi/openapi.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';

/** Cria e configura a aplicação HTTP (usada pelo `main` e pelos testes de integração). */
export async function createApp(
  options: { logger?: boolean } = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    ...(options.logger === false ? { logger: false } : {}),
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  if (options.logger !== false) app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cookieParser());
  // Corpo JSON: 15 MB só para o upload de planilhas (base64); 2 MB no restante (edição em massa).
  app.use(/^\/v1\/boards\/[^/]+\/imports$/, json({ limit: '15mb' }));
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: false, limit: '100kb' }));
  app.enableCors({
    origin: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    credentials: true,
    exposedHeaders: [
      'X-Request-Id',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Idempotent-Replayed',
    ],
  });
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
  if (config.REALTIME_MODE === 'embedded') {
    const adapter = new RedisIoAdapter(app, config);
    await adapter.connect();
    app.useWebSocketAdapter(adapter);
  }
  return app;
}

/** Monta a documentação OpenAPI (JSON em /v1/openapi.json e Swagger UI em /v1/docs). */
export function mountOpenApi(app: INestApplication): void {
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('v1/docs', app, () => document as never, {
    jsonDocumentUrl: 'v1/openapi.json',
  });
}
