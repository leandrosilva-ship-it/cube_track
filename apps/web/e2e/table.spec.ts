import { expect, test, type Page } from '@playwright/test';

import {
  addItem,
  login,
  newUserPage,
  openBoard,
  resetRateLimits,
  tableCell,
  USERS,
} from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

const unique = () => Date.now().toString(36);

async function chooseOption(page: Page, name: string): Promise<void> {
  await page.getByRole('option', { name, exact: true }).click();
}

test('edição inline em uma célula aparece destacada no outro navegador e o Ctrl+Z desfaz', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  const juliana = await newUserPage(browser, USERS.juliana.email);
  await openBoard(ana, 'Melhorias internas');
  await openBoard(juliana, 'Melhorias internas');

  const name = `Tabela ${unique()}`;
  await addItem(ana, name);
  await expect(juliana.getByRole('row').filter({ hasText: name })).toBeVisible();

  // Número: digitar na célula ativa inicia a edição (como numa planilha).
  const points = await tableCell(ana, name, 'Story points');
  await points.click();
  await ana.keyboard.type('8');
  await ana.keyboard.press('Enter');
  await expect(points).toHaveText('8');

  const remote = await tableCell(juliana, name, 'Story points');
  await expect(remote).toHaveText('8');
  // Gherkin: a célula alterada por outra pessoa recebe destaque visual.
  await expect(remote.locator('.ct-remote-highlight')).toBeVisible();

  // Status por popover; o desfazer volta o valor para todos.
  const status = await tableCell(ana, name, 'Status');
  await status.dblclick();
  await chooseOption(ana, 'Feito');
  await expect(status).toContainText('Feito');
  await expect(await tableCell(juliana, name, 'Status')).toContainText('Feito');
  await ana.getByRole('grid').press('Control+z');
  await expect(status).not.toContainText('Feito');
  await expect(await tableCell(juliana, name, 'Status')).not.toContainText('Feito');

  await ana.context().close();
  await juliana.context().close();
});

test('board por template de OS: "Processo SEI" obrigatório quando "OS emitida" = Sim, fórmula e importação', async ({
  page,
}) => {
  await login(page, USERS.ana.email);
  const boardName = `OS ${unique()}`;
  await page
    .getByRole('navigation', { name: 'Painel do workspace' })
    .getByRole('button', { name: 'Novo board' })
    .click();
  await page.getByRole('menuitem', { name: 'Novo board' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo board' });
  await dialog.getByLabel('Nome').fill(boardName);
  await dialog.getByRole('combobox', { name: 'Modelo' }).click();
  await chooseOption(page, 'Ordens de serviço (UST)');
  await dialog.getByRole('button', { name: 'Criar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: boardName })).toBeVisible();

  const item = 'OS de teste';
  await addItem(page, item);

  // Dado "OS emitida" = Sim, quando salvo sem "Processo SEI", então o sistema pede o campo.
  const issued = await tableCell(page, item, 'OS emitida');
  await issued.dblclick();
  await chooseOption(page, 'Sim');
  const required = page.getByRole('dialog', { name: 'Campos obrigatórios' });
  await expect(required).toBeVisible();
  await required.getByRole('button', { name: 'Salvar' }).click();
  await expect(required.getByRole('alert')).toContainText('Processo SEI');
  await required.getByRole('button', { name: 'Cancelar' }).click();
  await expect(issued).not.toContainText('Sim');

  await issued.dblclick();
  await chooseOption(page, 'Sim');
  await required.getByRole('textbox', { name: 'Processo SEI' }).fill('6016.2026/0001234-5');
  await required.getByRole('button', { name: 'Salvar' }).click();
  await expect(required).toBeHidden();
  await expect(issued).toContainText('Sim');
  await expect(await tableCell(page, item, 'Processo SEI')).toHaveText('6016.2026/0001234-5');

  // Fórmula ROUND({UST} * {Valor UST}, 2) recalculada no servidor.
  const ust = await tableCell(page, item, 'UST');
  await ust.click();
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  const price = await tableCell(page, item, 'Valor da UST');
  await price.click();
  await page.keyboard.type('150,5');
  await page.keyboard.press('Enter');
  await expect(await tableCell(page, item, 'Valor da OS')).toHaveText(/R\$\s?1\.505,00/);

  // Importar CSV com mapeamento sugerido.
  await page
    .getByRole('toolbar', { name: 'Ferramentas do board' })
    .getByRole('button', { name: 'Mais opções' })
    .click();
  await page.getByRole('menuitem', { name: 'Importar CSV/Excel' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Importar planilha' });
  await importDialog.locator('input[type="file"]').setInputFiles({
    name: 'ordens.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Nome;UST\nImportada A;3\nImportada B;4,5\n', 'utf8'),
  });
  await expect(importDialog.getByText('ordens.csv: 2 linhas')).toBeVisible();
  const nameTarget = importDialog.getByRole('combobox', { name: 'Destino de Nome' });
  if ((await nameTarget.textContent())?.includes('Nome do item') !== true) {
    await nameTarget.click();
    await chooseOption(page, 'Nome do item');
  }
  await importDialog.getByRole('button', { name: 'Importar 2 linhas' }).click();
  await expect(importDialog.getByRole('status')).toContainText('2 itens criados');
  await importDialog.getByRole('button', { name: 'Fechar' }).last().click();
  await expect(await tableCell(page, 'Importada B', 'UST')).toContainText('4,50');
});

test('50 mil itens: rolagem virtualizada a pelo menos 50 fps', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, USERS.ana.email);
  const panel = page.getByRole('navigation', { name: 'Painel do workspace' });
  await panel.getByLabel('Filtrar boards').fill('Carga');
  const link = panel.getByRole('link', { name: 'Carga — 50 mil itens', exact: true });
  const present = await link
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!present, 'Board de carga ausente: rode pnpm db:seed:large');
  await link.click();
  await expect(page.getByRole('status').filter({ hasText: '50.000 itens' })).toBeAttached({
    timeout: 180_000,
  });

  const grid = page.getByRole('grid');
  const result = await grid.evaluate(async (element) => {
    const run = (duration: number) =>
      new Promise<number[]>((resolve) => {
        const frames: number[] = [];
        const started = performance.now();
        let last = started;
        const step = (now: number) => {
          frames.push(now - last);
          last = now;
          // ~6.000 px/s: rolagem rápida com roda/trackpad.
          element.scrollTop += 100;
          if (now - started < duration) requestAnimationFrame(step);
          else resolve(frames.slice(1));
        };
        requestAnimationFrame(step);
      });
    // Aquecimento: JIT e coleta de lixo depois de carregar 50 mil itens.
    await run(1_000);
    const frames = await run(3_000);
    const sorted = [...frames].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1_000;
    const total = frames.reduce((sum, frame) => sum + frame, 0);
    return {
      medianFps: 1_000 / median,
      averageFps: (frames.length / total) * 1_000,
      rows: element.querySelectorAll('[role="row"]').length,
      scrolled: element.scrollTop,
    };
  });
  const summary = `mediana ${result.medianFps.toFixed(1)} fps, média ${result.averageFps.toFixed(1)} fps, ${String(result.rows)} linhas no DOM`;
  test.info().annotations.push({ type: 'fps', description: summary });
  console.info(summary);
  expect(result.scrolled).toBeGreaterThan(10_000);
  // Virtualização: o DOM mantém só as linhas visíveis (+ overscan), não 50 mil.
  expect(result.rows).toBeLessThan(150);
  // Gherkin: rolagem a pelo menos 50 fps (mediana dos quadros, robusta a pausas de GC).
  expect(result.medianFps).toBeGreaterThanOrEqual(50);
});
