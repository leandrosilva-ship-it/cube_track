import { expect, test } from '@playwright/test';

import { login, PASSWORD, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

test('rota protegida redireciona ao login e volta ao destino após entrar', async ({ page }) => {
  await page.goto('/inbox');
  await page.waitForURL(/\/login\?next=%2Finbox/);
  await page.getByLabel('E-mail').fill(USERS.ana.email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
});

test('credenciais inválidas mostram erro acessível', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(USERS.ana.email);
  await page.getByLabel('Senha').fill('senha-errada-123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'E-mail ou senha incorretos.',
  );
  await expect(page).toHaveURL(/\/login/);
});

test('validação no cliente associa erro ao campo', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const email = page.getByLabel('E-mail');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription('Informe um e-mail válido.');
});

test('sessão sobrevive ao recarregar (refresh cookie) e sair encerra', async ({ page }) => {
  await login(page, USERS.ana.email);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Olá, Ana/ })).toBeVisible();
  await page
    .getByRole('button', { name: `Menu do usuário: ${USERS.ana.name}` })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('telas públicas em outros idiomas', async ({ page }) => {
  await page.goto('/en/login');
  await expect(page.getByRole('heading', { name: 'Sign in to CUBE TRACK' })).toBeVisible();
  await page.goto('/es/auth/forgot-password');
  await expect(page.getByRole('heading', { name: 'Recuperar contraseña' })).toBeVisible();
  // Volta ao português pelo seletor de idioma (atualiza o cookie de idioma).
  await page.getByRole('combobox', { name: 'Idioma' }).click();
  await page.getByRole('option', { name: 'Português (Brasil)' }).click();
  await expect(page.getByRole('heading', { name: 'Recuperar senha' })).toBeVisible();
  await page.goto('/signup');
  await page.getByLabel('Nome da organização').fill('Prefeitura de São Paulo');
  await expect(page.getByLabel('Endereço da organização')).toHaveValue('prefeitura-de-sao-paulo');
});
