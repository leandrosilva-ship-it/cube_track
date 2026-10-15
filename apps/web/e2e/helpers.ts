import { createRequire } from 'node:module';

import { expect, type Browser, type Page } from '@playwright/test';
import { Redis } from 'ioredis';

export const PASSWORD = 'CubeTrack@2026';
export const USERS = {
  ana: { email: 'ana.ribeiro@empresademo.com.br', name: 'Ana Paula Ribeiro' },
  thiago: { email: 'thiago.pereira@empresademo.com.br', name: 'Thiago Pereira' },
  juliana: { email: 'juliana.castro@empresademo.com.br', name: 'Juliana Castro' },
} as const;

/** Zera os contadores de rate limit (muitos logins seguidos nos testes). */
export async function resetRateLimits(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  try {
    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

export async function login(page: Page, email: string, next?: string): Promise<void> {
  await page.goto(next === undefined ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  if (new URL(page.url()).pathname.startsWith('/organizations')) {
    await page.getByRole('button', { name: /Empresa Demo/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/organizations'));
  }
}

export async function newUserPage(browser: Browser, email: string, next?: string): Promise<Page> {
  const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await context.newPage();
  await login(page, email, next);
  return page;
}

/** Abre um board pelo painel lateral (navegação client-side). */
export async function openBoard(page: Page, name: string): Promise<void> {
  const panel = page.getByRole('navigation', { name: 'Painel do workspace' });
  const filter = panel.getByLabel('Filtrar boards');
  await filter.fill(name);
  await panel
    .getByRole('list', { name: 'Boards' })
    .getByRole('link', { name, exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await filter.fill('');
}

/** Marca o documento atual: se a navegação recarregar a página, a marca some. */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __ctMarker?: number }).__ctMarker = 42;
  });
}

export async function expectSameDocument(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as { __ctMarker?: number }).__ctMarker)).toBe(
    42,
  );
}

/** Varredura axe-core (WCAG 2.1 A/AA) na página atual. */
export async function expectAccessible(
  page: Page,
  options: { exclude?: string[] } = {},
): Promise<void> {
  const require = createRequire(import.meta.url);
  await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
  const violations = await page.evaluate(async (exclude) => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: unknown,
            options: unknown,
          ) => Promise<{
            violations: { id: string; help: string; nodes: { target: string[] }[] }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run(
      { exclude: exclude.map((selector) => [selector]) },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
    );
    return result.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} → ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
    );
  }, options.exclude ?? []);
  expect(violations, violations.join('\n')).toEqual([]);
}

/** Célula da Tabela pelo nome do item e título da coluna (ARIA grid). */
export async function tableCell(page: Page, itemName: string, columnTitle: string) {
  const header = page
    .getByRole('columnheader')
    .filter({ has: page.getByText(columnTitle, { exact: true }) })
    .first();
  const index = await header.getAttribute('aria-colindex');
  return page
    .getByRole('row')
    .filter({ hasText: itemName })
    .first()
    .locator(`[role="gridcell"][aria-colindex="${index ?? ''}"]`);
}

/** Linha de "adicionar item" do primeiro grupo visível. */
export async function addItem(page: Page, name: string): Promise<void> {
  const input = page.getByRole('textbox', { name: 'Adicionar item', exact: true }).first();
  await input.fill(name);
  await input.press('Enter');
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
}
