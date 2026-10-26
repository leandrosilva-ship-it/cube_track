import { expect, test } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

test('webhook: criação mostra o segredo uma única vez; desabilitar propaga em tempo real', async ({
  browser,
}) => {
  // Duas sessões da mesma pessoa (dois navegadores/dispositivos) — evita depender de qual papel
  // cada usuário seedado tem `webhook.manage` neste board, mas ainda exercita duas conexões reais.
  const ana = await newUserPage(browser, USERS.ana.email);
  const anaSecondTab = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  await openBoard(anaSecondTab, 'Melhorias internas');

  await ana.getByRole('button', { name: 'Integrar', exact: true }).click();
  const list = ana.getByRole('dialog', { name: 'Webhooks' });
  await list.getByRole('button', { name: 'Novo webhook', exact: true }).click();

  const webhookName = `Sistema externo ${Date.now()}`;
  const form = ana.getByRole('dialog', { name: 'Novo webhook' });
  await form.getByRole('textbox', { name: 'Nome' }).fill(webhookName);
  await form.getByRole('textbox', { name: 'URL' }).fill('https://example.com/hooks/cube-track');
  await form.getByText('Item atualizado', { exact: true }).click();
  await form.getByRole('button', { name: 'Salvar', exact: true }).click();

  // O segredo HMAC só é mostrado agora — nunca mais volta a aparecer depois disto.
  const secretDialog = ana.getByRole('dialog', { name: 'Segredo do webhook' });
  await expect(secretDialog).toBeVisible();
  const secretText = await secretDialog.locator('p.font-mono').textContent();
  expect(secretText?.trim().length).toBeGreaterThan(10);
  await secretDialog.getByRole('button', { name: 'Concluído', exact: true }).click();
  await expect(secretDialog).toBeHidden();
  await expect(list.getByText(webhookName)).toBeVisible();

  // Tempo real: a segunda sessão já tinha o diálogo de webhooks aberto quando o webhook nasceu.
  await anaSecondTab.getByRole('button', { name: 'Integrar', exact: true }).click();
  const otherList = anaSecondTab.getByRole('dialog', { name: 'Webhooks' });
  await expect(otherList.getByText(webhookName)).toBeVisible({ timeout: 10_000 });

  // Desabilitar no primeiro navegador reflete no segundo sem recarregar (evento `webhook.changed`).
  // Único webhook deste board criado neste teste: o switch "Ativo" identifica-o sem ambiguidade.
  await list.getByRole('switch', { name: 'Ativo' }).click();
  await expect(otherList.getByText('Desativado')).toBeVisible({ timeout: 10_000 });

  await ana.context().close();
  await anaSecondTab.context().close();
});
