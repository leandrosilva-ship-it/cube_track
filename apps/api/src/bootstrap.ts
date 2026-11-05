import 'reflect-metadata';

import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, urlencoded, type Request } from 'express';
import helmet from 'helmet';
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
  // Cabeçalhos de segurança (ADR 0057, OWASP): a API não serve HTML de produto algum (só o Swagger
  // UI embutido em /v1/docs, servido localmente pelo @nestjs/swagger — sem CDN), daí a CSP restrita
  // a 'self'. `style-src 'unsafe-inline'` é necessário para o Swagger UI (estilos inline do próprio
  // pacote); nunca liberado para script. HSTS, X-Content-Type-Options e frame-ancestors 'none' vêm
  // dos padrões do helmet (nunca enquadrável em outro site — não há por que ser).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(cookieParser());
  // Guarda o corpo BRUTO (antes do parse) em `req.rawBody`: webhooks de entrada (GitHub, Slack, ADR
  // 0056) assinam/validam sobre os bytes exatos recebidos (JSON ou form-encoded, caso do comando de
  // barra do Slack), não sobre o corpo reserializado.
  const captureRawBody = (req: Request, _res: unknown, buf: Buffer) => {
    req.rawBody = buf;
  };
  // Corpo JSON: 15 MB só para o upload de planilhas (base64); 2 MB no restante (edição em massa).
  app.use(/^\/v1\/boards\/[^/]+\/imports$/, json({ limit: '15mb', verify: captureRawBody }));
  app.use(json({ limit: '2mb', verify: captureRawBody }));
  app.use(urlencoded({ extended: false, limit: '100kb', verify: captureRawBody }));
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
      // SCIM 2.0 (ADR 0057): convenção do protocolo é `/scim/v2/...`, sem o prefixo `/v1`.
      { path: 'scim/v2', method: RequestMethod.ALL },
      { path: 'scim/v2/{*path}', method: RequestMethod.ALL },
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
