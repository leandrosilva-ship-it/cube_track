import { createDatabase } from '../client.js';
import { requireEnv } from '../env.js';
import { LARGE_BOARD_NAME, seedLargeBoard } from '../seed/large.js';

const count = Number(process.argv[2] ?? 50_000);
const handle = createDatabase(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const started = Date.now();
  const result = await seedLargeBoard(handle.db, count);
  console.info(
    result.created
      ? `Board "${LARGE_BOARD_NAME}" criado com ${String(count)} itens em ${String(Math.round((Date.now() - started) / 1000))} s (${result.boardId}).`
      : `Board "${LARGE_BOARD_NAME}" já existe (${result.boardId}).`,
  );
} finally {
  await handle.close();
}
