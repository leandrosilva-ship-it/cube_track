import { expect, test } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

test('gerenciar views: renomear, duplicar, tornar padrão e link público', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');

  // Cria uma view compartilhada para gerenciar (sem mexer na "Quadro principal" padrão).
  await ana.getByRole('button', { name: 'Nova view', exact: true }).click();
  await ana.getByRole('menuitem', { name: 'Tabela', exact: true }).click();
  await expect(ana.getByText('View "Nova Tabela" criada.')).toBeVisible();

  const actions = ana.getByRole('button', { name: 'Ações da view "Nova Tabela"' });
  await actions.click();

  // Renomear.
  ana.once('dialog', (dialog) => {
    void dialog.accept('Tabela de testes');
  });
  await ana.getByRole('menuitem', { name: 'Renomear', exact: true }).click();
  await expect(ana.getByText('View renomeada.')).toBeVisible();
  await expect(ana.getByRole('link', { name: 'Tabela de testes', exact: true })).toBeVisible();

  // Duplicar: a cópia nasce com o mesmo nome + sufixo e vira a view ativa.
  await ana
    .getByRole('button', { name: 'Ações da view "Tabela de testes"' })
    .click();
  await ana.getByRole('menuitem', { name: 'Duplicar', exact: true }).click();
  await expect(ana.getByText('View "Tabela de testes (cópia)" duplicada.')).toBeVisible();
  const copyTab = ana.getByRole('link', { name: 'Tabela de testes (cópia)', exact: true });
  await expect(copyTab).toBeVisible();
  await expect(copyTab).toHaveAttribute('aria-current', 'page');

  // Tornar padrão.
  await ana
    .getByRole('button', { name: 'Ações da view "Tabela de testes (cópia)"' })
    .click();
  await ana.getByRole('menuitem', { name: 'Tornar padrão', exact: true }).click();
  await expect(ana.getByText('"Tabela de testes (cópia)" agora é a view padrão.')).toBeVisible();

  // Link público: criar, ver o token revelado e revogar.
  await ana
    .getByRole('button', { name: 'Ações da view "Tabela de testes (cópia)"' })
    .click();
  await ana.getByRole('menuitem', { name: 'Link público', exact: true }).click();
  const dialog = ana.getByRole('dialog', { name: 'Link público' });
  await dialog.getByRole('button', { name: 'Criar link público', exact: true }).click();
  await expect(ana.getByText('Link atualizado.')).toBeVisible();
  await expect(dialog.getByText(/\/public\/share\//)).toBeVisible();
  ana.once('dialog', (confirmDialog) => {
    void confirmDialog.accept();
  });
  await dialog.getByRole('button', { name: 'Revogar link', exact: true }).click();
  await expect(ana.getByText('Link revogado.')).toBeVisible();

  await ana.context().close();
});
