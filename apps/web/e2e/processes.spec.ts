import { expect, test, type Locator, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/** Cria uma view Kanban nova (agrupada por grupo/fase por padrão) pelo menu "+". */
async function createKanbanView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Kanban', exact: true }).click();
  await expect(page.getByText('View "Nova Kanban" criada.')).toBeVisible();
}

/** Coluna do Kanban pelo nome da fase (raia única: `.first()` basta). */
function kanbanColumn(page: Page, label: string): Locator {
  return page.getByRole('group', { name: label, exact: true }).first();
}

/** Arrasta um cartão até outra coluna do Kanban (mesmo padrão de kanban.spec.ts). */
async function dragToColumn(page: Page, card: Locator, targetColumn: Locator): Promise<void> {
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

test('Kanban de processo: indicadores de fase/WIP e badge de SLA vencido', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Triagem de solicitações');
  await createKanbanView(ana);

  const emTriagem = kanbanColumn(ana, 'Em triagem');
  await expect(emTriagem).toBeVisible();
  // Fase intermediária com limite de WIP 5 e 2 itens da carga (ADR 0051).
  await expect(emTriagem.getByText('Intermediária', { exact: true })).toBeVisible();
  await expect(emTriagem.getByText('2/5', { exact: true })).toBeVisible();

  // O item seedado como violado (tracker `status: 'breached'`) mostra o badge "Vencido há ...".
  const breachedCard = emTriagem.getByRole('button', {
    name: 'Solicitação: ajuste de permissão no SIGRC COHAB',
  });
  await expect(breachedCard.getByText(/Vencido há/)).toBeVisible();

  await ana.context().close();
});

test('Kanban de processo: transição bloqueada por campo obrigatório mostra o motivo e não move o item', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Triagem de solicitações');
  await createKanbanView(ana);

  const emTriagem = kanbanColumn(ana, 'Em triagem');
  const encaminhada = kanbanColumn(ana, 'Encaminhada');

  // Cria um item novo em "Em triagem": nasce sem "Estimativa (UST)", exigida pela regra de
  // transição para "Encaminhada" (ADR 0051) — só pede agora o único campo obrigatório do board.
  await emTriagem.getByRole('button', { name: 'Novo item', exact: true }).click();
  const required = ana.getByRole('dialog', { name: 'Campos obrigatórios' });
  await required
    .locator('[data-testid="required-c_solicitante"]')
    .getByRole('textbox')
    .fill('teste@cliente.exemplo.gov.br');
  await required.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(required).toBeHidden();

  const card = emTriagem.getByRole('button', { name: 'Item sem título', exact: true }).first();
  await expect(card).toBeVisible();

  await dragToColumn(ana, card, encaminhada);

  // Mensagem específica do servidor (`transition_required_fields`) em vez de um erro genérico.
  await expect(
    ana.getByText('Preencha os campos obrigatórios desta transição antes de mover o item.'),
  ).toBeVisible();
  // O item continua em "Em triagem" — a transição foi recusada, não só avisada.
  await expect(emTriagem.getByRole('button', { name: 'Item sem título' })).toBeVisible();
  await expect(encaminhada.getByRole('button', { name: 'Item sem título' })).toHaveCount(0);

  await ana.context().close();
});
