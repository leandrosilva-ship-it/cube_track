import { expect, test, type Locator, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/** Cria a view "Carga de trabalho" pelo menu "+" (nasce "Nova Carga de trabalho" e já navega). */
async function createWorkloadView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Carga de trabalho', exact: true }).click();
  await expect(page.getByText('View "Nova Carga de trabalho" criada.')).toBeVisible();
}

/**
 * Só com granularidade diária (+ agrupar por pessoa, já padrão) o arrastar-e-soltar da view
 * Workload fica habilitado (ADR 0052) — troca pelo seletor "Granularidade".
 */
async function useDailyGranularity(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Granularidade' }).click();
  await page.getByRole('option', { name: 'Dia', exact: true }).click();
}

/** Rótulos (datas) das colunas do heatmap, na mesma ordem para todas as linhas. */
async function headerDates(page: Page): Promise<string[]> {
  return page.locator('div.flex.h-9.min-w-14.items-center.justify-center').allTextContents();
}

/** Localiza a linha (pessoa) do heatmap pelo rótulo exibido (nome, time ou skill). */
function rowByLabel(page: Page, label: string): Locator {
  return page
    .locator('div.border-b.border-border.py-1')
    .filter({ has: page.locator('div.w-40.shrink-0.truncate', { hasText: label }) });
}

/** Célula de uma linha pelo índice da coluna (mesma ordem de `headerDates`). */
function cellAt(page: Page, label: string, columnIndex: number): Locator {
  return rowByLabel(page, label).getByRole('button').nth(columnIndex);
}

interface MovablePair {
  personLabel: string;
  fromIndex: number;
  toIndex: number;
  hours: string;
}

/**
 * Acha, na primeira pessoa com alguma alocação visível no período padrão do heatmap, um dia com
 * horas (célula arrastável) e um dia vazio da mesma linha — usa os dados já semeados do board PMSP
 * (ADR 0052) em vez de depender de datas fixas, que ficariam desatualizadas com o tempo.
 */
async function findMovablePair(page: Page): Promise<MovablePair> {
  const rows = page.locator('div.border-b.border-border.py-1');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const label = (await row.locator('div.w-40.shrink-0.truncate').textContent())?.trim();
    if (label === undefined || label === '') continue;
    const values = await row.getByRole('button').allTextContents();
    const fromIndex = values.findIndex((value) => value.trim() !== '·');
    const toIndex = values.findIndex((value) => value.trim() === '·');
    if (fromIndex !== -1 && toIndex !== -1) {
      return { personLabel: label, fromIndex, toIndex, hours: values[fromIndex]?.trim() ?? '' };
    }
  }
  throw new Error('Nenhuma pessoa com alocação e espaço livre no período padrão do heatmap de carga.');
}

/** Arrasta uma célula do heatmap até outra (mesmo padrão de `dragWithinColumn` do Kanban: dnd-kit
 * exige passos intermediários de mouse para disparar o sensor de arraste). */
async function dragCell(page: Page, from: Locator, to: Locator): Promise<void> {
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (fromBox === null || toBox === null) throw new Error('Limites do arraste ausentes.');
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(fromBox.x + fromBox.width / 2 + 10, fromBox.y + fromBox.height / 2, { steps: 5 });
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 10 });
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 5 });
  await page.mouse.up();
}

test('workload: arrastar uma célula do heatmap redistribui a alocação e propaga em tempo real', async ({
  browser,
}) => {
  // Duas sessões da mesma pessoa (mesmo recurso usado em webhooks.spec.ts): o que importa aqui é
  // ter `resources.manage` de verdade (papel workspace_admin da Ana no seed), não qual papel
  // específico cada usuário semeado tem no board PMSP especificamente.
  const ana = await newUserPage(browser, USERS.ana.email);
  const anaSecondTab = await newUserPage(browser, USERS.ana.email);

  await openBoard(ana, 'PMSP');
  await createWorkloadView(ana);
  await useDailyGranularity(ana);

  await openBoard(anaSecondTab, 'PMSP');
  await anaSecondTab.getByRole('link', { name: 'Nova Carga de trabalho' }).click();

  const { personLabel, fromIndex, toIndex, hours } = await findMovablePair(ana);

  await dragCell(ana, cellAt(ana, personLabel, fromIndex), cellAt(ana, personLabel, toIndex));

  // Na própria sessão que arrastou: a origem esvazia e o destino passa a mostrar as horas movidas.
  await expect(cellAt(ana, personLabel, fromIndex)).toHaveText('·', { timeout: 10_000 });
  await expect(cellAt(ana, personLabel, toIndex)).toHaveText(hours, { timeout: 10_000 });

  // `allocation.changed` chega pela room do board PMSP (ambas as sessões o têm aberto) e invalida o
  // heatmap em cache — a segunda sessão vê o mesmo resultado sem recarregar a página.
  const secondHeaderDates = await headerDates(anaSecondTab);
  expect(secondHeaderDates).toEqual(await headerDates(ana));
  await expect(cellAt(anaSecondTab, personLabel, toIndex)).toHaveText(hours, { timeout: 10_000 });
  await expect(cellAt(anaSecondTab, personLabel, fromIndex)).toHaveText('·', { timeout: 10_000 });

  await ana.context().close();
  await anaSecondTab.context().close();
});
