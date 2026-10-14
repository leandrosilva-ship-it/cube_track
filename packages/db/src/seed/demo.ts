import { eq } from 'drizzle-orm';

import { appendAuditLog } from '../audit.js';
import { withTenant, type Database } from '../client.js';
import { provisionTenant } from '../provisioning.js';
import { tenants } from '../schema/index.js';
import { DEMO_TENANT_ID, DEMO_TENANT_SLUG, userId, type SeedContext } from './context.js';
import { seedPmspBoard } from './pmsp.js';
import { SeededRandom } from './random.js';
import { seedResources } from './resources.js';
import { seedOtherBoards, seedPeople, seedPmspExperience, seedWorkspace } from './workspace.js';

export interface DemoSeedResult {
  created: boolean;
  tenantId: string;
  boardId?: string;
}

/**
 * Popula o tenant "Empresa Demo" com o caso de referência PMSP. Idempotente: se o tenant já
 * existir, nada é feito (use `db:reset` para recriar). Tudo roda numa única transação com
 * contexto de tenant — o mesmo caminho (e as mesmas políticas RLS) usado pela aplicação.
 */
export async function seedDemo(db: Database): Promise<DemoSeedResult> {
  return withTenant(db, { tenantId: DEMO_TENANT_ID }, async (tx) => {
    const existing = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, DEMO_TENANT_ID));
    if (existing.length > 0) return { created: false, tenantId: DEMO_TENANT_ID };

    const provisioned = await provisionTenant(tx, {
      id: DEMO_TENANT_ID,
      name: 'Empresa Demo',
      slug: DEMO_TENANT_SLUG,
      legalName: 'Empresa Demo Consultoria em Tecnologia Ltda.',
      document: '12.345.678/0001-95',
      calendar: { name: 'São Paulo/SP', stateCode: 'SP', cityIbgeCode: '3550308' },
    });
    const ctx: SeedContext = {
      tx,
      tenantId: provisioned.tenantId,
      rng: new SeededRandom(20_261_014),
      users: {},
      roleIds: provisioned.roleIds,
      calendarId: provisioned.calendarId,
      workspaceId: '',
      folderIds: {},
      teamIds: {},
    };

    await seedPeople(ctx);
    const workspace = await seedWorkspace(ctx);
    const pmsp = await seedPmspBoard(ctx, {
      programId: workspace.programId,
      portfolioId: workspace.portfolioId,
      folderId: ctx.folderIds['Sustentação'] ?? '',
    });
    await seedPmspExperience(ctx, pmsp, workspace);
    await seedResources(ctx, pmsp);
    await seedOtherBoards(ctx);

    await appendAuditLog(tx, {
      tenantId: ctx.tenantId,
      actorId: userId(ctx, 'ana'),
      actorKind: 'system',
      action: 'tenant.seeded',
      entityType: 'tenant',
      entityId: ctx.tenantId,
      after: { name: 'Empresa Demo', slug: DEMO_TENANT_SLUG },
      metadata: { source: 'seed', dataset: 'pmsp' },
    });

    return { created: true, tenantId: ctx.tenantId, boardId: pmsp.boardId };
  });
}
