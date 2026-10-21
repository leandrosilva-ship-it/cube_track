import { expect, test, type Locator, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/** Cria uma view Kanban nova pelo menu "+" (nasce "Nova Kanban" e já navega para ela). */
async function createKanbanView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Kanban', exact: true }).click();
  await expect(page.getByText('View "Nova Kanban" criada.')).toBeVisible();
}

async function configureKanban(
  page: Page,
  options: {
    columnsBy?: string;
    swimlanesBy?: string;
    wipLimit?: { column: string; limit: string };
  },
): Promise<void> {
  await page.getByRole('button', { name: 'Configurar Kanban', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configurar Kanban' });
  if (options.columnsBy !== undefined) {
    await dialog.getByRole('combobox', { name: 'Colunas por' }).click();
    await page.getByRole('option', { name: options.columnsBy, exact: true }).click();
  }
  if (options.swimlanesBy !== undefined) {
    await dialog.getByRole('combobox', { name: 'Raias por' }).click();
    await page.getByRole('option', { name: options.swimlanesBy, exact: true }).click();
  }
  if (options.wipLimit !== undefined) {
    await dialog
      .getByRole('spinbutton', { name: `Limite para "${options.wipLimit.column}"` })
      .fill(options.wipLimit.limit);
  }
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('Configuração do Kanban salva.')).toBeVisible();
}

/** Coluna do Kanban pelo nome do balde (raias repetem o nome — `.first()` pega a primeira raia). */
function kanbanColumn(page: Page, label: string): Locator {
  return page.getByRole('group', { name: label, exact: true }).first();
}

async function dragWithinColumn(page: Page, card: Locator, targetColumn: Locator): Promise<void> {
  const cardBox = await card.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (cardBox === null || targetBox === null) throw new Error('Limites do arraste ausentes.');
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 15, cardBox.y + cardBox.height / 2, {
    steps: 5,
  });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 20, {
    steps: 10,
  });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 20, {
    steps: 5,
  });
  await page.mouse.up();
}

test('Kanban por Frente com raias por grupo: cria rápido, mostra colunas/raias, arrasta em tempo real', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const juliana = await newUserPage(browser, USERS.juliana.email);
  await openBoard(ana, 'PMSP');
  await openBoard(juliana, 'PMSP');

  const started = Date.now();
  await createKanbanView(ana);
  await configureKanban(ana, { columnsBy: 'Frente de Trabalho', swimlanesBy: 'Grupo do board' });
  expect(Date.now() - started).toBeLessThan(60_000);

  // Colunas (Frente) e raias (grupo) aparecem.
  await expect(kanbanColumn(ana, 'Aplicativo')).toBeVisible();
  await expect(kanbanColumn(ana, 'SIGRC')).toBeVisible();
  await expect(ana.getByText('Demandas em Análise', { exact: true }).first()).toBeVisible();

  // Cria um cartão direto na coluna "Aplicativo" e arrasta para "SIGRC" (mesma raia). O board
  // exige "Órgão" (obrigatório) além da Frente, que o próprio quick-create já preenche.
  const applicativo = kanbanColumn(ana, 'Aplicativo');
  await applicativo.getByRole('button', { name: 'Novo item', exact: true }).click();
  const required = ana.getByRole('dialog', { name: 'Campos obrigatórios' });
  await required.getByText('SMIT', { exact: true }).click();
  await required.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(required).toBeHidden();
  const card = applicativo.getByRole('button', { name: 'Item sem título', exact: true }).first();
  await expect(card).toBeVisible();
  await dragWithinColumn(ana, card, kanbanColumn(ana, 'SIGRC'));
  await expect(kanbanColumn(ana, 'SIGRC').getByRole('button', { name: 'Item sem título' })).toBeVisible();

  // Tempo real: a Juliana, na view Tabela (outra view, outro navegador), vê o campo atualizado.
  const julianaRow = juliana
    .getByRole('row')
    .filter({ hasText: 'Item sem título' })
    .filter({ hasText: 'SIGRC' });
  await expect(julianaRow).toBeVisible({ timeout: 10_000 });

  await ana.context().close();
  await juliana.context().close();
});

test('Kanban: limite de WIP destaca a coluna acima do limite', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  await createKanbanView(ana);
  await configureKanban(ana, {
    columnsBy: 'Frente de Trabalho',
    wipLimit: { column: 'Aplicativo', limit: '1' },
  });

  const badge = kanbanColumn(ana, 'Aplicativo').getByText(/^\d+\/1$/);
  await expect(badge).toBeVisible();
  const [count] = (await badge.textContent())?.split('/').map(Number) ?? [0];
  // O board já tem demandas reais na frente "Aplicativo" (carga do PMSP): acima do limite de 1.
  expect(count).toBeGreaterThan(1);
  await expect(badge).toHaveClass(/text-danger/);

  await ana.context().close();
});
