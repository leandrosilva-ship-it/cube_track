import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

const dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_SCHEDULE = path.join(dirname, 'fixtures', 'sample-schedule.xml');

/** Cria uma view nova pelo menu "+" (nasce "Nova {tipo}" e já navega para ela). */
async function createView(page: Page, type: string): Promise<void> {
  await page.getByRole('button', { name: 'Nova view', exact: true }).click();
  await page.getByRole('menuitem', { name: type, exact: true }).click();
  await expect(page.getByText(`View "Nova ${type}" criada.`)).toBeVisible();
}

/** Importa o cronograma de exemplo (2 tarefas + 1 dependência FS) na view Gantt atual. */
async function importSampleSchedule(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Importar MS Project', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar cronograma (MS Project .xml)' });
  await dialog.getByLabel('Escolher arquivo').setInputFiles(SAMPLE_SCHEDULE);
  await expect(dialog.getByText('2 tarefas encontradas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
  await expect(dialog.getByText(/itens criados/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
}

function ganttBar(page: Page, name: string) {
  // A barra (área do gráfico) tem rótulo acessível "{nome} ({início} → {fim})"; o botão da
  // coluna EAP/Nome tem rótulo igual só ao nome — o filtro por "(" escolhe a barra.
  return page.getByRole('button', { name: new RegExp(`^${name} \\(`) });
}

test('Gantt: arrastar a barra do predecessor reagenda o sucessor dependente (FS)', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  await createView(ana, 'Gantt');
  await importSampleSchedule(ana);

  const requirements = ganttBar(ana, 'Levantamento de requisitos');
  const development = ganttBar(ana, 'Desenvolvimento');
  await expect(requirements).toBeVisible();
  await expect(development).toBeVisible();
  const developmentBefore = await development.getAttribute('aria-label');

  // Zoom "Dia" dá mais pixels por dia de arraste (precisão do mouse).
  await ana.getByRole('combobox', { name: 'Zoom' }).click();
  await ana.getByRole('option', { name: 'Dia', exact: true }).click();

  const box = await requirements.boundingBox();
  if (box === null) throw new Error('Barra do predecessor sem posição.');
  await ana.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await ana.mouse.down();
  await ana.mouse.move(box.x + box.width / 2 + 3 * 64, box.y + box.height / 2, { steps: 10 });
  await ana.mouse.up();

  // O worker recalcula o sucessor (FS) de forma assíncrona; o evento realtime atualiza o Gantt.
  await expect(development).not.toHaveAttribute('aria-label', developmentBefore ?? '', {
    timeout: 15_000,
  });

  await ana.context().close();
});

test('Gantt: caminho crítico é destacado (barra e conector) após o recálculo', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'Melhorias internas');
  await createView(ana, 'Gantt');
  await importSampleSchedule(ana);

  await ana.getByRole('button', { name: 'Configurar Gantt', exact: true }).click();
  await ana
    .getByRole('dialog', { name: 'Configurar Gantt' })
    .getByRole('switch', { name: 'Destacar caminho crítico' })
    .click();
  await ana.keyboard.press('Escape');

  // As duas tarefas encadeadas por FS, sem folga, ficam no caminho crítico (classe de destaque).
  await expect(ganttBar(ana, 'Levantamento de requisitos')).toHaveClass(/bg-danger/);
  await expect(ganttBar(ana, 'Desenvolvimento')).toHaveClass(/bg-danger/);
  await expect(ana.locator('svg path.stroke-danger')).toHaveCount(1);

  await ana.context().close();
});
