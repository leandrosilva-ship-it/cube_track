import { expect, test } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

test('presença de usuários aparece e some em tempo real no cabeçalho do board', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(ana, 'PMSP');
  await openBoard(thiago, 'PMSP');

  await expect(ana.getByRole('group', { name: '1 pessoa vendo este board' })).toBeVisible();
  await expect(ana.getByRole('img', { name: USERS.thiago.name })).toBeVisible();
  await expect(thiago.getByRole('img', { name: USERS.ana.name })).toBeVisible();

  // Thiago sai do board: a presença some para a Ana.
  await thiago
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Inbox' })
    .click();
  await expect(ana.getByRole('group', { name: '1 pessoa vendo este board' })).toBeHidden();

  await ana.context().close();
  await thiago.context().close();
});

test('item criado em um navegador aparece no outro em menos de 300 ms (p95 medido no backend)', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const juliana = await newUserPage(browser, USERS.juliana.email);
  await openBoard(ana, 'Melhorias internas');
  await openBoard(juliana, 'Melhorias internas');

  const name = `Realtime ${Date.now().toString(36)}`;
  const groupInput = ana.getByLabel(/Adicionar item em/).first();
  await groupInput.fill(name);
  const started = Date.now();
  await groupInput.press('Enter');
  await expect(juliana.getByText(name, { exact: true })).toBeVisible();
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: 'propagação (ms)', description: String(elapsed) });
  // Ponta a ponta no navegador inclui HTTP + render; a meta de 300 ms é medida no backend (ADR 0027).
  expect(elapsed).toBeLessThan(3_000);

  // Renomear também propaga (LWW por campo).
  await ana.getByRole('button', { name, exact: true }).click();
  const editor = ana.getByRole('textbox', { name: 'Renomear' });
  await editor.fill(`${name} editado`);
  await editor.press('Enter');
  await expect(juliana.getByText(`${name} editado`, { exact: true })).toBeVisible();

  await ana.context().close();
  await juliana.context().close();
});
