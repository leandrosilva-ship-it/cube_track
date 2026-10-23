import { expect, test, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/** Cria uma view nova pelo menu "+" (nasce "Nova {tipo}" e já navega para ela). */
async function createDashboardView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByText('View "Nova Dashboard" criada.')).toBeVisible();
  await page.getByRole('button', { name: 'Criar dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Widget', exact: true })).toBeVisible();
}

/** Adiciona um widget "Número" contando itens do board (sem coluna = contagem de itens). */
async function addCountWidget(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Widget', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Adicionar widget' });
  await dialog.getByRole('textbox', { name: 'Título' }).fill(title);
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText(title)).toBeVisible();
}

test('dashboard: criar um widget aparece em tempo real no outro navegador', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(ana, 'Melhorias internas');
  await createDashboardView(ana);

  await openBoard(thiago, 'Melhorias internas');
  await thiago.getByRole('link', { name: 'Nova Dashboard' }).click();

  await addCountWidget(ana, 'Itens no board');

  // O evento `widget.changed` chega pela room do board (ambos têm o board aberto) e invalida os
  // dados do dashboard — o widget aparece sem recarregar a página.
  await expect(thiago.getByText('Itens no board')).toBeVisible({ timeout: 10_000 });
});

test('saúde do projeto: relatar atualiza o widget project_health em tempo real', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(ana, 'Melhorias internas');
  await createDashboardView(ana);

  await ana.getByRole('button', { name: 'Widget', exact: true }).click();
  const dialog = ana.getByRole('dialog', { name: 'Adicionar widget' });
  await dialog.getByRole('combobox', { name: 'Tipo de widget' }).click();
  await ana.getByRole('option', { name: 'Saúde do projeto', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Título' }).fill('Saúde');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(ana.getByText('Nenhum relato de saúde ainda.')).toBeVisible();

  await openBoard(thiago, 'Melhorias internas');
  await thiago.getByRole('link', { name: 'Nova Dashboard' }).click();
  await expect(thiago.getByText('Nenhum relato de saúde ainda.')).toBeVisible();

  await ana.getByRole('button', { name: 'Relatar saúde', exact: true }).click();
  const reportDialog = ana.getByRole('dialog', { name: 'Relatar saúde do projeto' });
  await reportDialog.getByRole('combobox', { name: 'Geral' }).click();
  await ana.getByRole('option', { name: 'Vermelho (crítico)', exact: true }).click();
  await reportDialog.getByRole('button', { name: 'Relatar', exact: true }).click();
  await expect(ana.getByText('Saúde do projeto relatada.')).toBeVisible();

  // `project_health.reported` chega pela room do board (ambos com o board aberto) e invalida os
  // dados do dashboard em cada navegador que os tiver em cache.
  await expect(thiago.getByText('Nenhum relato de saúde ainda.')).toHaveCount(0, { timeout: 10_000 });
});
