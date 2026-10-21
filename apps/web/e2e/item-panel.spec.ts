import { expect, test, type Page } from '@playwright/test';

import { addItem, newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

const unique = () => Date.now().toString(36);

/** Abre o painel de um item pela ação "Abrir" (ícone que aparece ao passar o mouse na linha). */
async function openItemPanel(page: Page, itemName: string): Promise<void> {
  const row = page.getByRole('row').filter({ hasText: itemName });
  await row.hover();
  await row.getByRole('button', { name: `Abrir ${itemName}` }).click();
  await expect(page).toHaveURL(/[?&]item=/);
  await expect(page.getByRole('heading', { name: itemName, exact: true })).toBeVisible();
}

test('painel do item: URL própria (deep link), abas e navegação', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  const name = `Painel ${unique()}`;
  await addItem(ana, name);
  await openItemPanel(ana, name);

  for (const tab of ['Atualizações', 'Arquivos', 'Atividade', 'Campos', 'Subitens', 'Dependências', 'Aprovações'])
    await expect(ana.getByRole('tab', { name: tab })).toBeVisible();

  // Deep link: recarregar a página mantém o painel aberto no mesmo item.
  const url = ana.url();
  await ana.reload();
  await expect(ana).toHaveURL(url);
  await expect(ana.getByRole('heading', { name, exact: true })).toBeVisible();

  // Fechar volta a URL ao board, sem o item.
  await ana.getByRole('button', { name: 'Fechar' }).click();
  await expect(ana).not.toHaveURL(/[?&]item=/);

  await ana.context().close();
});

test('uma @menção numa atualização notifica o usuário mencionado em tempo real', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(ana, 'Melhorias internas');
  await openBoard(thiago, 'Melhorias internas');

  const name = `Menção ${unique()}`;
  await addItem(ana, name);
  await openItemPanel(ana, name);
  await openItemPanel(thiago, name);

  const composer = ana.getByRole('textbox', { name: 'Escreva uma atualização… use @ para mencionar' });
  await composer.click();
  await composer.pressSequentially(`Olá @${USERS.thiago.name.split(' ')[0] ?? ''}`);
  await ana.getByRole('option', { name: USERS.thiago.name }).click();
  await composer.pressSequentially(', pode revisar isso?');
  await ana.getByRole('button', { name: 'Publicar', exact: true }).click();

  // Tempo real: a atualização aparece no painel já aberto de Thiago sem recarregar a página.
  await expect(thiago.getByText('pode revisar isso?')).toBeVisible();

  // Notificação: a menção gera uma notificação in-app (processada pelo worker a partir do outbox).
  await thiago.goto('/inbox');
  await expect
    .poll(
      async () => {
        if (await thiago.getByText(/mencionou você/).first().isVisible()) return true;
        await thiago.reload();
        return false;
      },
      { timeout: 20_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(true);

  await ana.context().close();
  await thiago.context().close();
});

test('o log de atividade registra a alteração do campo Nome', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  const name = `Atividade ${unique()}`;
  const renamed = `${name} renomeado`;
  await addItem(ana, name);
  await openItemPanel(ana, name);

  await ana.getByRole('tab', { name: 'Campos' }).click();
  const nameField = ana.getByRole('textbox', { name: 'Nome' });
  await nameField.fill(renamed);
  await nameField.blur();
  await expect(ana.getByRole('heading', { name: renamed, exact: true })).toBeVisible();

  await ana.getByRole('tab', { name: 'Atividade' }).click();
  await expect(ana.getByText(`"${name}"`)).toBeVisible();
  await expect(ana.getByText(`"${renamed}"`)).toBeVisible();

  await ana.context().close();
});

test('checklist: progresso é recalculado ao marcar um item como concluído', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  const name = `Checklist ${unique()}`;
  await addItem(ana, name);
  await openItemPanel(ana, name);

  await ana.getByRole('tab', { name: 'Subitens' }).click();
  await ana.getByRole('textbox', { name: 'Novo checklist' }).fill('Revisão');
  await ana.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(ana.getByText('Revisão')).toBeVisible();

  const newItemInput = ana.getByRole('textbox', { name: 'Novo item' });
  await newItemInput.fill('Conferir textos');
  await newItemInput.press('Enter');
  await expect(ana.getByText('Conferir textos')).toBeVisible();
  await expect(ana.getByText('0/1')).toBeVisible();

  await ana.getByRole('checkbox', { name: 'Conferir textos' }).click();
  await expect(ana.getByText('1/1')).toBeVisible();

  await ana.context().close();
});

test('aprovação: pedido e decisão propagam em tempo real entre dois navegadores', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const thiago = await newUserPage(browser, USERS.thiago.email);
  await openBoard(ana, 'Melhorias internas');
  await openBoard(thiago, 'Melhorias internas');

  const name = `Aprovação ${unique()}`;
  await addItem(ana, name);
  await openItemPanel(ana, name);
  await openItemPanel(thiago, name);

  await ana.getByRole('tab', { name: 'Aprovações' }).click();
  await thiago.getByRole('tab', { name: 'Aprovações' }).click();

  await ana.getByRole('button', { name: 'Solicitar aprovação', exact: true }).click();
  await ana
    .getByRole('listitem')
    .filter({ hasText: USERS.thiago.name })
    .getByRole('checkbox')
    .check();
  await ana.getByRole('button', { name: 'Enviar pedido', exact: true }).click();

  // Tempo real: Thiago vê o pedido pendente aparecer sem recarregar.
  await expect(thiago.getByText('Pendente')).toBeVisible();
  await thiago.getByRole('button', { name: 'Aprovar', exact: true }).click();

  // Tempo real: Ana vê o status mudar para "Aprovado" sem recarregar.
  await expect(ana.getByText('Aprovado')).toBeVisible();

  await ana.context().close();
  await thiago.context().close();
});
