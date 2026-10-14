import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { loadConfig } from '../config/config.js';
import { currentContext } from '../context/request-context.js';

/** Logs estruturados (pino) com correlation id, tenant e usuário em toda linha. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: () => {
        const config = loadConfig();
        return {
          pinoHttp: {
            level: config.LOG_LEVEL,
            genReqId: (request, response) => {
              const header = response.getHeader('X-Request-Id');
              return typeof header === 'string'
                ? header
                : String(request.headers['x-request-id'] ?? '');
            },
            mixin: () => {
              const store = currentContext();
              return store === undefined
                ? {}
                : {
                    requestId: store.requestId,
                    tenantId: store.principal?.tenantId ?? store.tenant?.tenantId,
                    userId: store.principal?.userId,
                  };
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.password',
                '*.token',
              ],
              censor: '[redacted]',
            },
            autoLogging: { ignore: (request) => request.url?.startsWith('/health') === true },
            serializers: {
              req: (request: { id: string; method: string; url: string }) => ({
                id: request.id,
                method: request.method,
                url: request.url,
              }),
            },
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
