import { createDatabase } from '../client.js';
import { requireEnv } from '../env.js';
import { DEMO_FORM_TOKEN, DEMO_SHARE_TOKEN } from '../seed/context.js';
import { DEMO_PASSWORD, seedDemoCredentials } from '../seed/credentials.js';
import { seedDemo } from '../seed/demo.js';
import { seedPublicTemplates } from '../seed/templates.js';

const handle = createDatabase(requireEnv('DATABASE_URL'), { max: 1 });
try {
  const result = await seedDemo(handle.db);
  await seedDemoCredentials(handle.db);
  // Galeria pública de templates (ADR 0056): dado da PLATAFORMA, não do tenant demo — roda sempre,
  // mesmo quando o tenant demo já existe (idempotente por conta própria).
  const templatesResult = await seedPublicTemplates(handle.db);
  if (templatesResult.created) {
    console.info(`Galeria pública de templates semeada: ${String(templatesResult.count)} templates.`);
  }
  console.info(
    `Login de demonstração (somente dev): ana.ribeiro@empresademo.com.br / senha "${DEMO_PASSWORD}".`,
  );
  if (result.created) {
    console.info(
      `Seed concluído: tenant "Empresa Demo" (${result.tenantId}), board PMSP ${result.boardId ?? ''}.`,
    );
    console.info(
      `Link público de demonstração: token "${DEMO_SHARE_TOKEN}"; formulário: token "${DEMO_FORM_TOKEN}".`,
    );
  } else {
    console.info(
      'Tenant de demonstração já existe — nada a fazer (use pnpm db:reset para recriar).',
    );
  }
} finally {
  await handle.close();
}
