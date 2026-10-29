import { expect, test, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/**
 * A página `/w/:workspaceId/portfolio` não tem um link direto a partir de um board — navega pela
 * URL usando o `workspaceId` já visível na URL do board aberto (mesma ideia de extrair IDs da URL
 * em vez de depender de um seletor de workspace, mais frágil).
 */
async function gotoPortfolioPage(page: Page): Promise<void> {
  const match = /\/w\/([^/]+)\//.exec(page.url());
  if (match === null) throw new Error('workspaceId não encontrado na URL atual.');
  await page.goto(`/w/${match[1]}/portfolio`);
  await expect(page.getByRole('heading', { level: 1, name: 'Portfólio' })).toBeVisible();
}

/** Cria uma view "Dashboard" pelo menu "+" (nasce "Nova Dashboard" e já navega). */
async function createDashboardView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('View "Nova Dashboard" criada.')).toBeVisible();
  await page.getByRole('button', { name: 'Criar dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Widget', exact: true })).toBeVisible();
}

test('portfólio: hierarquia mostra o rollup real do board PMSP (ADR 0053)', async ({ browser }) => {
  // Ana é workspace_admin (papel "owner" no seed) — tem `portfolio.manage`, então vê os botões de
  // gerenciar além do rollup. O portfólio semeado "Contratos Públicos" tem 1 projeto (PMSP) com o
  // relato de saúde mais recente em 63% / verde (packages/db/src/seed/workspace.ts) — valores reais
  // do seed, não inventados, para não depender de nenhuma ação prévia neste teste.
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  await gotoPortfolioPage(ana);

  // `rollup.boards` é a string literal "{count} projeto(s)" (não plural ICU) — "(s)" é texto fixo.
  const card = ana.locator('div').filter({ hasText: 'Contratos Públicos' }).first();
  await expect(card.getByText('1 projeto(s)')).toBeVisible();
  await expect(card.getByText('63.0%')).toBeVisible();
  await expect(card.getByText('Verde (no prazo)')).toBeVisible();
  // `portfolio.manage`: vê a ação de criar programa/portfólio.
  await expect(ana.getByRole('button', { name: 'Novo portfólio', exact: true })).toBeVisible();
});

test('portfólio: quem só tem portfolio.read vê o rollup mas não as ações de gerenciar', async ({
  browser,
}) => {
  // Thiago tem papel "viewer" no seed → role workspace_viewer, que só carrega `portfolio.read`
  // (packages/db/src/provisioning.ts) — nunca `portfolio.manage`. `tree.canManagePortfolio` (API
  // `GET /v1/workspaces/:id/tree`) resolve isso para o frontend (ADR 0053, mesmo padrão de
  // `canManageResources`/`canApproveTimesheet` do Prompt 11) — aqui comprovamos que o front
  // realmente respeita essa permissão, não só o cálculo isolado.
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(thiago, 'PMSP');
  await gotoPortfolioPage(thiago);

  await expect(thiago.getByText('Contratos Públicos')).toBeVisible();
  await expect(thiago.getByText('1 projeto(s)')).toBeVisible();
  await expect(thiago.getByRole('button', { name: 'Novo portfólio', exact: true })).toHaveCount(0);
  await expect(thiago.getByRole('button', { name: 'Novo programa', exact: true })).toHaveCount(0);
});

test('dashboard: widget "Rollup de portfólio/programa" aparece em tempo real e mostra dados reais', async ({
  browser,
}) => {
  // O CRUD de widget (criar/editar/excluir) já tem tempo real desde o Prompt 9 — `widget.changed`
  // chega pela room do board e invalida os dados do dashboard em qualquer sessão com o board aberto
  // (ver `apps/web/src/realtime/apply.ts`). O que é novo aqui (Prompt 12) é só o TIPO de widget e o
  // dado real que ele mostra — por isso este teste reaproveita exatamente o padrão de
  // `dashboards.spec.ts` (criar widget num navegador, ver aparecer no outro sem recarregar).
  const ana = await newUserPage(browser, USERS.ana.email);
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(ana, 'PMSP');
  await createDashboardView(ana);

  await openBoard(thiago, 'PMSP');
  await thiago.getByRole('link', { name: 'Nova Dashboard' }).click();

  const widgetTitle = `Rollup PMSP ${Date.now()}`;
  await ana.getByRole('button', { name: 'Widget', exact: true }).click();
  const dialog = ana.getByRole('dialog', { name: 'Adicionar widget' });
  await dialog.getByRole('combobox', { name: 'Tipo de widget' }).click();
  await ana.getByRole('option', { name: 'Rollup de portfólio/programa', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Escopo' }).click();
  await ana.getByRole('option', { name: 'Portfólio', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Portfólio/programa' }).click();
  await ana.getByRole('option', { name: 'Contratos Públicos', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Título' }).fill(widgetTitle);
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();

  // Na própria sessão que criou: mostra o rollup real (mesmos valores do teste de hierarquia acima).
  // Escopa pelo card do widget (div.rounded-lg que contém o <h3> do título, widget-card.tsx) em vez
  // de `getByText` solto, já que "Verde (no prazo)" também aparece potencialmente em outros widgets.
  const heading = ana.getByRole('heading', { level: 3, name: widgetTitle, exact: true });
  await expect(heading).toBeVisible();
  const ownCard = ana.locator('div.rounded-lg.border.border-border').filter({ has: heading });
  await expect(ownCard.getByText('Verde (no prazo)')).toBeVisible();

  // Segunda sessão (Thiago, só `portfolio.read`, mas o widget é do board que ele também pode ler):
  // `widget.changed` chega pela room do board — o widget aparece sem recarregar.
  await expect(thiago.getByText(widgetTitle)).toBeVisible({ timeout: 10_000 });
});
