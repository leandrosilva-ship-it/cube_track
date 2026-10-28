import { expect, test, type Locator, type Page } from '@playwright/test';

import { addItem, newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/**
 * Busca o item recém-criado no popover "Adicionar item" do apontamento semanal. O índice do Meilisearch
 * é assíncrono (ADR 0011): tenta de novo com uma consulta ligeiramente diferente a cada rodada para
 * forçar uma nova busca em vez de reaproveitar um resultado vazio já em cache (React Query).
 */
async function addTimesheetRow(page: Page, itemName: string): Promise<void> {
  await page.getByRole('button', { name: 'Adicionar item', exact: true }).click();
  const searchBox = page.getByRole('textbox', { name: 'Buscar item…', exact: true });
  const result = page.getByRole('button', { name: itemName, exact: true });
  await expect(async () => {
    await searchBox.fill(itemName.slice(0, -1));
    await searchBox.fill(itemName);
    await expect(result).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await result.click();
}

function rowFor(page: Page, itemName: string): Locator {
  return page.getByRole('row').filter({ hasText: itemName });
}

test('timesheet: apontar horas, enviar a semana e a aprovação do gestor propagam em tempo real', async ({
  browser,
}) => {
  // Duas sessões da mesma pessoa (mesmo recurso usado em webhooks.spec.ts): a Ana tem de verdade
  // tanto acesso ao board (para criar o item) quanto `timesheet.approve` (papel workspace_admin do
  // seed) para aprovar — não depende de qual papel específico cada usuário semeado tem.
  const ana = await newUserPage(browser, USERS.ana.email);
  const anaApprover = await newUserPage(browser, USERS.ana.email);

  const itemName = `Apontamento E2E ${Date.now()}`;
  await openBoard(ana, 'Melhorias internas');
  await addItem(ana, itemName);

  await ana.getByRole('link', { name: 'Timesheet', exact: true }).click();
  await expect(ana.getByRole('heading', { level: 1, name: 'Timesheet' })).toBeVisible();

  await addTimesheetRow(ana, itemName);
  const row = rowFor(ana, itemName);
  const mondayCell = row.getByRole('spinbutton').first();
  await mondayCell.fill('4');
  await mondayCell.press('Tab');
  await expect(row.getByText('4', { exact: true })).toBeVisible();

  await ana.getByRole('button', { name: 'Enviar semana', exact: true }).click();
  await expect(ana.getByText('Semana enviada para aprovação.')).toBeVisible();
  await expect(ana.getByText('Enviada', { exact: true })).toBeVisible();
  // Semana bloqueada: a célula não aceita mais edição.
  await expect(mondayCell).toBeDisabled();

  await anaApprover.getByRole('link', { name: 'Timesheet', exact: true }).click();
  await anaApprover.getByRole('tab', { name: 'Aprovações', exact: true }).click();
  // A fila pode ter outras semanas pendentes do seed: isola pela pessoa (mesmo nome do seed, ADR 0052).
  const pendingRow = anaApprover.getByRole('listitem').filter({ hasText: 'Ana Paula Ribeiro' });
  await expect(pendingRow).toBeVisible({ timeout: 10_000 });
  await pendingRow.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(anaApprover.getByText('Semana aprovada.')).toBeVisible();

  // `timesheet_approval.changed` é tenant-wide (sem board): a sessão que enviou a semana vê o status
  // mudar para "Aprovada" sem recarregar a página.
  await expect(ana.getByText('Aprovada', { exact: true })).toBeVisible({ timeout: 10_000 });

  await ana.context().close();
  await anaApprover.context().close();
});
