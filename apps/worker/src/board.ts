import { createHash, timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import express, { type NextFunction, type Request, type Response } from 'express';

import type { QueueRegistry } from './queues.js';

export const BOARD_BASE_PATH = '/admin/queues';

/** Comparação em tempo constante (digests de tamanho fixo não vazam o comprimento do segredo). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

/** Autenticação HTTP Basic com comparação em tempo constante. */
export function basicAuth(user: string, password: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const header = request.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded !== undefined) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const givenUser = separator === -1 ? decoded : decoded.slice(0, separator);
      const givenPassword = separator === -1 ? '' : decoded.slice(separator + 1);
      const userOk = safeEqual(givenUser, user);
      const passwordOk = safeEqual(givenPassword, password);
      if (userOk && passwordOk) {
        next();
        return;
      }
    }
    response.setHeader('WWW-Authenticate', 'Basic realm="CUBE TRACK filas", charset="UTF-8"');
    response.status(401).type('text/plain').send('Autenticação necessária.');
  };
}

export interface BoardAppOptions {
  queues: QueueRegistry;
  /** Sem credenciais o painel não é montado (somente health checks). */
  credentials: { user: string; password: string } | null;
  ready: () => Promise<boolean>;
}

/** App HTTP do worker: Bull Board protegido em /admin/queues e health checks (liveness/readiness). */
export function createBoardApp(options: BoardAppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health/live', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.get('/health/ready', (_request, response) => {
    void options.ready().then(
      (ready) => response.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' }),
      () => response.status(503).json({ status: 'unavailable' }),
    );
  });
  if (options.credentials !== null) {
    const adapter = new ExpressAdapter();
    adapter.setBasePath(BOARD_BASE_PATH);
    createBullBoard({
      queues: Object.values(options.queues).map((queue) => new BullMQAdapter(queue)),
      serverAdapter: adapter,
    });
    app.use(
      BOARD_BASE_PATH,
      basicAuth(options.credentials.user, options.credentials.password),
      adapter.getRouter() as express.Router,
    );
  }
  return app;
}

export function listen(app: express.Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, (error?: Error) => {
      if (error === undefined) resolve(server);
      else reject(error);
    });
  });
}
