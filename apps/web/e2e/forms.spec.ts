import { expect, test, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

const unique = () => Date.now().toString(36);

async function createFormView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Formulário', exact: true }).click();
  await expect(page.getByText('View "Nova Formulário" criada.')).toBeVisible();
  await page.getByRole('button', { name: 'Criar formulário', exact: true }).click();
}

/** Adiciona o campo "Nome do item" (nativo, reservado) pelo popover "+ Adicionar campo". */
async function addNameField(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Adicionar campo', exact: true }).click();
  await page.getByRole('button', { name: 'Nome do item', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('textbox', { name: 'Rótulo do campo' })).toHaveValue('Nome do item');
}

/** Publica o formulário e devolve a URL pública revelada (token em claro, só nesta resposta). */
async function publishForm(page: Page): Promise<string> {
  await page.getByRole('switch', { name: 'Público' }).click();
  await expect(page.getByText('Link público emitido.')).toBeVisible();
  const url = await page.getByText(/\/public\/forms\//).textContent();
  if (url === null || url.trim() === '') throw new Error('Link público não encontrado.');
  return url.trim();
}

test('formulário público: preenchimento anônimo cria um item visível em tempo real no board', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  await createFormView(ana);
  await addNameField(ana);
  const publicUrl = await publishForm(ana);

  // Visitante anônimo (sem login, navegador separado) preenche o formulário público.
  const visitor = await browser.newContext({ locale: 'pt-BR' });
  const page = await visitor.newPage();
  await page.goto(publicUrl);

  const itemName = `Enviado pelo formulário ${unique()}`;
  await page.getByLabel('Nome do item', { exact: false }).fill(itemName);

  const captchaLabel = await page.getByText(/Quanto é \d+ \+ \d+\?/).textContent();
  const match = captchaLabel?.match(/(\d+)\s*\+\s*(\d+)/);
  if (match === null || match === undefined) throw new Error('Pergunta do captcha não encontrada.');
  const answer = Number(match[1]) + Number(match[2]);
  await page.getByLabel('Resposta', { exact: false }).fill(String(answer));

  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('Obrigado! Sua resposta foi registrada.')).toBeVisible();
  await visitor.close();

  // O item criado pelo envio público aparece em tempo real na Tabela do board, para quem o criou.
  await ana.getByRole('link', { name: 'Tabela', exact: true }).click();
  await expect(ana.getByRole('row').filter({ hasText: itemName })).toBeVisible({ timeout: 10_000 });

  await ana.context().close();
});

test('formulário interno: preenchimento autenticado cria um item sem precisar do link público', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  await createFormView(ana);
  await addNameField(ana);

  await ana.getByRole('button', { name: 'Preencher', exact: true }).click();
  const dialog = ana.getByRole('dialog', { name: 'Preencher formulário' });
  const itemName = `Preenchido internamente ${unique()}`;
  await dialog.getByLabel('Nome do item', { exact: false }).fill(itemName);
  await dialog.getByRole('button', { name: 'Criar item', exact: true }).click();
  await expect(ana.getByText('Item criado a partir do formulário.')).toBeVisible();

  await ana.getByRole('link', { name: 'Tabela', exact: true }).click();
  await expect(ana.getByRole('row').filter({ hasText: itemName })).toBeVisible();

  await ana.context().close();
});
