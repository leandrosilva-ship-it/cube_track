import { expect, test, type Locator, type Page } from '@playwright/test';

import { addItem, newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/** Cria uma view Kanban nova pelo menu "+" (nasce "Nova Kanban" e já navega para ela). */
async function createKanbanView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Kanban', exact: true }).click();
  await expect(page.getByText('View "Nova Kanban" criada.')).toBeVisible();
}

/** Coluna do Kanban pelo nome do grupo (raia única: `.first()` basta). */
function kanbanColumn(page: Page, label: string): Locator {
  return page.getByRole('group', { name: label, exact: true }).first();
}

/** Cria uma coluna de botão na Tabela ("+" no fim do cabeçalho). */
async function createButtonColumn(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Adicionar coluna' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nova coluna' });
  await dialog.getByRole('textbox', { name: 'Título' }).fill(title);
  await dialog.getByRole('combobox', { name: 'Tipo' }).click();
  await page.getByRole('option', { name: 'Botão', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Texto do botão' }).fill(title);
  await dialog.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Cria uma automação "botão clicado" → "mover para grupo" pelo diálogo "Automatizar". A ordem dos
 * `combobox` sem rótulo próprio segue a renderização do formulário (ADR 0051): Gatilho, Coluna de
 * botão (só aparece após escolher o gatilho), tipo da ação, Grupo de destino (só após escolher a ação).
 */
async function createButtonAutomation(
  page: Page,
  options: { name: string; buttonColumnTitle: string; targetGroup: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Automatizar', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Automações' })
    .getByRole('button', { name: 'Nova automação', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Nova automação' });
  await form.getByRole('textbox', { name: 'Nome' }).fill(options.name);
  const combos = form.getByRole('combobox');
  await combos.nth(0).click();
  await page.getByRole('option', { name: 'Botão é clicado', exact: true }).click();
  await combos.nth(1).click();
  await page.getByRole('option', { name: options.buttonColumnTitle, exact: true }).click();
  await combos.nth(2).click();
  await page.getByRole('option', { name: 'Mover para grupo', exact: true }).click();
  await combos.nth(3).click();
  await page.getByRole('option', { name: options.targetGroup, exact: true }).click();
  await form.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(form).toBeHidden();
}

test('automação dispara ao clicar no botão: move o item para outro grupo em tempo real', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');

  const buttonTitle = 'Aprovar';
  await createButtonColumn(ana, buttonTitle);
  await createButtonAutomation(ana, {
    name: 'Mover ao aprovar',
    buttonColumnTitle: buttonTitle,
    targetGroup: 'Backlog',
  });
  await createKanbanView(ana);

  // Thiago observa a view Kanban (já compartilhada) do início ao fim — sem recarregar a página.
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(thiago, 'Melhorias internas');
  await thiago.getByRole('link', { name: 'Nova Kanban' }).click();
  await expect(kanbanColumn(thiago, 'Sprint 14')).toBeVisible();
  await expect(kanbanColumn(thiago, 'Backlog')).toBeVisible();

  // Ana volta à Tabela (único lugar onde o botão é clicável), cria o item e aciona a automação.
  await ana.getByRole('link', { name: 'Tabela', exact: true }).click();
  const itemName = `Item automação ${Date.now()}`;
  await addItem(ana, itemName);

  // Chegada do item em "Sprint 14" (1º grupo) é visível em tempo real para o Thiago.
  await expect(kanbanColumn(thiago, 'Sprint 14').getByText(itemName)).toBeVisible({
    timeout: 10_000,
  });

  const row = ana.getByRole('row').filter({ hasText: itemName });
  await row.getByRole('button', { name: buttonTitle, exact: true }).click();

  // A automação dispara no worker e move o item: o Thiago vê o card migrar de coluna sem recarregar.
  await expect(kanbanColumn(thiago, 'Backlog').getByText(itemName)).toBeVisible({
    timeout: 10_000,
  });
  await expect(kanbanColumn(thiago, 'Sprint 14').getByText(itemName)).toHaveCount(0);

  await ana.context().close();
  await thiago.context().close();
});
