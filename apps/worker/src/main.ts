import { loadWorkerConfig } from './config.js';
import { logger } from './logger.js';
import { startWorker } from './worker.js';

const SHUTDOWN_TIMEOUT_MS = 30_000;

const config = loadWorkerConfig();
const running = await startWorker(config, logger);

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Encerrando worker (aguardando jobs em andamento)');
  const timer = setTimeout(() => {
    logger.error('Tempo de encerramento excedido; finalizando à força');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timer.unref();
  running.stop().then(
    () => process.exit(0),
    (error: unknown) => {
      logger.error({ err: error }, 'Falha no encerramento');
      process.exit(1);
    },
  );
};
process.once('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  shutdown('SIGINT');
});
