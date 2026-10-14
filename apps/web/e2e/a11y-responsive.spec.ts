import { expect, test } from '@playwright/test';

import { expectAccessible, login, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

test('telas base sem violações WCAG 2.1 AA (axe)', async ({ page }) => {
  await page.goto('/login');
  await expectAccessible(page);
  await login(page, USERS.ana.email);
  await expect(page.getByRole('heading', { level: 1, name: /Olá/ })).toBeVisible();
  await expectAccessible(page);
  await openBoard(page, 'PMSP');
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expectAccessible(page);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
  await expectAccessible(page);
});

test('tema escuro também passa no axe', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await login(page, USERS.ana.email);
  await openBoard(page, 'PMSP');
  await expectAccessible(page);
});

test('mobile (360 px): menu do workspace em drawer e barra inferior', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    locale: 'pt-BR',
    hasTouch: true,
  });
  const page = await context.newPage();
  await login(page, USERS.ana.email);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Painel do workspace' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: 'PMSP', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'PMSP' })).toBeVisible();
  await expect(drawer).toBeHidden();
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Minha semana' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Minha semana' })).toBeVisible();
  await context.close();
});
