import { expect, test } from '@playwright/test';

import { addItem, login, openBoard, resetRateLimits, tableCell, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

const unique = () => Date.now().toString(36);

/**
 * Importação em background (Prompt 15, ADR 0056): fluxo completo do assistente "Importar" do
 * cabeçalho do board — origem → upload → mapeamento → commit (processado no worker) → confirmação.
 * Diferente do importador síncrono de CSV/Excel já coberto em `table.spec.ts` (menu "Mais opções" →
 * "Importar CSV/Excel", `features/table/import-dialog.tsx`): este é o `ImportWizardDialog`
 * (`features/imports/import-wizard-dialog.tsx`), com acompanhamento de progresso por polling/evento
 * realtime `import_job.changed` — requer o worker rodando (`pnpm --filter @cube-track/worker start`),
 * como os demais fluxos assíncronos da suíte (automations.spec.ts, webhooks.spec.ts).
 */
test('assistente de importação: CSV com nome e uma coluna mapeada manualmente cria os itens no board', async ({
  page,
}) => {
  await login(page, USERS.ana.email);
  await openBoard(page, 'Melhorias internas');

  const nameA = `Importado via wizard A ${unique()}`;
  const nameB = `Importado via wizard B ${unique()}`;

  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar para o board' });
  await expect(dialog).toBeVisible();

  // Passo 1 (origem): CSV genérico já vem selecionado por padrão.
  await expect(dialog.getByRole('combobox', { name: 'Origem' })).toHaveText('CSV/Excel');
  await dialog.getByRole('button', { name: 'Avançar', exact: true }).click();

  // Passo 2 (upload): CSV com cabeçalho "Nome" (mapeamento automático) e "Pontos" (sem equivalente
  // automático — título real da coluna é "Story points", mapeado manualmente a seguir).
  const csv = `Nome;Pontos\n${nameA};5\n${nameB};8\n`;
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'backlog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });

  // Passo 3 (mapeamento): a prévia mostra as 2 linhas e os cabeçalhos de origem.
  await expect(dialog.getByText('2 linhas encontradas')).toBeVisible();
  await expect(dialog.getByRole('columnheader', { name: 'Coluna de origem' })).toBeVisible();
  const nameTarget = dialog.getByRole('combobox', { name: 'Mapeamento da coluna Nome' });
  await expect(nameTarget).toHaveText('Nome do item');
  const pointsTarget = dialog.getByRole('combobox', { name: 'Mapeamento da coluna Pontos' });
  await expect(pointsTarget).toHaveText('Ignorar');
  await pointsTarget.click();
  await page.getByRole('option', { name: 'Story points', exact: true }).click();
  await expect(pointsTarget).toHaveText('Story points');

  await dialog.getByRole('button', { name: 'Importar 2 linhas', exact: true }).click();

  // Passo 4 (progresso): processado no worker a partir da fila `imports` — acompanhado por polling.
  // `.first()`: enquanto ainda "processando", a `Spinner` interna também tem `role="status"` (seu
  // próprio `aria-label`) — `getByRole('status')` sozinho bate em 2 elementos durante essa janela e
  // o modo estrito do Playwright aborta a asserção; `.first()` sempre resolve o container externo
  // (o único que sobra quando o estado muda para concluído). pt-BR: 0 cai na categoria "one" do CLDR
  // (singular, "0 linha pulada"), não "other" como em inglês.
  const status = dialog.getByRole('status').first();
  await expect(status).toContainText('2 itens criados', { timeout: 20_000 });
  await expect(status).toContainText('0 linha pulada');
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
  await expect(dialog).toBeHidden();

  // Confirmação: os itens aparecem no board, com a coluna mapeada manualmente ("Pontos" → "Story
  // points") preenchida — não só o nome, que vem do mapeamento automático.
  await expect(page.getByRole('row').filter({ hasText: nameA })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: nameB })).toBeVisible();
  await expect(await tableCell(page, nameA, 'Story points')).toHaveText('5');
  await expect(await tableCell(page, nameB, 'Story points')).toHaveText('8');
});

test('assistente de importação: linha sem nome é pulada e reportada, sem travar o commit', async ({
  page,
}) => {
  await login(page, USERS.ana.email);
  await openBoard(page, 'Melhorias internas');

  // Item de controle: garante que o board já tem ao menos uma linha antes da importação, para que a
  // contagem de "pulada" não possa ser confundida com um board vazio.
  const control = `Controle ${unique()}`;
  await addItem(page, control);

  const name = `Importado via wizard C ${unique()}`;
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar para o board' });
  await dialog.getByRole('button', { name: 'Avançar', exact: true }).click();

  // Segunda linha com a célula de "Nome" vazia (mas não a linha inteira — senão o parser de CSV a
  // descarta antes mesmo de chegar à prévia): no commit, nada mapeia para o nome do item, então a
  // linha é pulada e reportada, sem travar as demais.
  const csv = `Nome;Pontos\n${name};5\n;8\n`;
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'com-linha-sem-nome.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await expect(dialog.getByText('2 linhas encontradas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Importar 2 linhas', exact: true }).click();

  const status = dialog.getByRole('status').first();
  await expect(status).toContainText('1 item criado', { timeout: 20_000 });
  await expect(status).toContainText('1 linha pulada');
  await expect(dialog.getByText('Linhas puladas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();

  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
});
