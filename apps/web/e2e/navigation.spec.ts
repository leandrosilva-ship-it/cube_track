import { expect, test } from '@playwright/test';

import {
  expectSameDocument,
  login,
  markDocument,
  openBoard,
  resetRateLimits,
  USERS,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await resetRateLimits();
  await login(page, USERS.ana.email);
});

test('navega entre páginas, workspace e boards sem recarregar o documento', async ({ page }) => {
  await markDocument(page);
  await openBoard(page, 'PMSP');
  await expect(
    page.getByRole('navigation', { name: 'Views do board' }).getByRole('link').first(),
  ).toHaveAttribute('aria-current', 'page');
  await openBoard(page, 'Melhorias internas');
  const nav = page.getByRole('navigation', { name: 'Navegação principal' });
  await nav.getByRole('link', { name: 'Minha semana' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Minha semana' })).toBeVisible();
  await nav.getByRole('link', { name: 'Inbox' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await nav.getByRole('link', { name: 'Favoritos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Favoritos' })).toBeVisible();
  await page.getByRole('button', { name: 'Selecionar workspace' }).click();
  await page.getByRole('menuitem', { name: 'Área de trabalho principal' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Área de trabalho principal' }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Favoritos' })).toBeVisible();
  await expectSameDocument(page);
});

test('paleta de comandos (Ctrl+K) e atalhos de teclado', async ({ page }) => {
  await markDocument(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Paleta de comandos' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('PMSP');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'PMSP' })).toBeVisible();
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await page.keyboard.press('Shift+?');
  await expect(page.getByRole('dialog', { name: 'Atalhos de teclado' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expectSameDocument(page);
});

test('cria pasta e board, favorita e reorganiza pelo teclado', async ({ page }) => {
  const suffix = Date.now().toString(36);
  const panel = page.getByRole('navigation', { name: 'Painel do workspace' });
  await panel.getByRole('button', { name: 'Novo board' }).click();
  await page.getByRole('menuitem', { name: 'Nova pasta' }).click();
  await page
    .getByRole('dialog', { name: 'Nova pasta' })
    .getByLabel(/Nome/)
    .fill(`Pasta E2E ${suffix}`);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(panel.getByRole('button', { name: `Pasta E2E ${suffix}` })).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await panel.getByRole('button', { name: 'Novo board' }).click();
  await page.getByRole('menuitem', { name: 'Novo board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo board' });
  await dialog.getByLabel(/Nome/).fill(`Board E2E ${suffix}`);
  await dialog.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Board E2E ${suffix}` })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /Novo grupo/ })).toBeVisible();

  await page.getByRole('button', { name: 'Favoritar board' }).click();
  await expect(panel.getByRole('region').or(panel.locator('section')).first()).toContainText(
    `Board E2E ${suffix}`,
  );

  // Reorganizar com teclado: espaço pega o board, seta para cima vai até a pasta, espaço solta (entra na pasta).
  const boardLink = panel
    .getByRole('list', { name: 'Boards' })
    .getByRole('link', { name: `Board E2E ${suffix}` });
  await boardLink.focus();
  await page.keyboard.press('Space');
  for (let step = 0; step < 15; step += 1) {
    await page.keyboard.press('ArrowUp');
  }
  await page.keyboard.press('Space');
  await expect(panel.getByRole('list', { name: 'Boards' })).toBeVisible();
});
