import { expect, test, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/**
 * Módulo Contratos/OS/UST (ADR 0054, Prompt 13). Usa sempre os dados semeados em
 * `packages/db/src/seed/workspace.ts`: contrato "012/2025" (workspace "Área de trabalho principal",
 * vinculado ao board PMSP) e o catálogo de serviços com o Código Edital "D1" (UST padrão 40) — mesmos
 * dados que `apps/api/test/contracts.e2e.test.ts` usa, para não duplicar fixtures. Números de OS/fatura
 * novos usam `Date.now()` para não colidir entre execuções.
 */

/** workspaceId visível na URL de um board já aberto (mesmo padrão de `portfolio.spec.ts`). */
function workspaceIdFromUrl(page: Page): string {
  const match = /\/w\/([^/]+)\//.exec(page.url());
  const workspaceId = match?.[1];
  if (workspaceId === undefined) throw new Error('workspaceId não encontrado na URL atual.');
  return workspaceId;
}

/**
 * Tela de Contratos (nível workspace, `/w/:workspaceId/contracts`) — sem link direto a partir de um
 * board (mesma situação do Portfólio em `portfolio.spec.ts`), navega direto pela URL.
 */
async function gotoContractsPage(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`/w/${workspaceId}/contracts`);
  await expect(page.getByRole('heading', { level: 1, name: 'Contratos' })).toBeVisible();
}

/** Card do contrato "012/2025" na listagem — seleciona (expande o detalhe) ao clicar. */
function contract012Card(page: Page) {
  return page.getByRole('button', { name: /012\/2025/ });
}

/** Texto do saldo exibido no card (ex.: "10.944 UST restantes") — span fixo em `contracts-page.tsx`. */
function contractBalanceText(page: Page) {
  return contract012Card(page).locator('span').filter({ hasText: 'UST restantes' });
}

/** Abre o diálogo "Ordens de Serviço" do cabeçalho do board (só aparece quando `board.contractId` existe). */
async function openServiceOrdersDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ordens de Serviço', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Ordens de Serviço' })).toBeVisible();
}

/** Cria uma OS avulsa no board (sem item) a partir do diálogo já aberto e deixa na tela de detalhe. */
async function createServiceOrder(page: Page, number: string): Promise<void> {
  await page.getByRole('button', { name: 'Nova OS', exact: true }).click();
  await page.getByRole('textbox', { name: 'Número da OS', exact: true }).fill(number);
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.getByText('OS criada.')).toBeVisible();
  // O título do diálogo muda para o número da OS; o número também aparece (de novo) no corpo — por
  // isso `.first()`: o que importa aqui é só confirmar que a view de detalhe abriu.
  await expect(page.getByRole('dialog').getByText(number, { exact: true }).first()).toBeVisible();
}

test('OS/UST critério de aceite 1: aceitar uma OS vinculada ao contrato 012/2025 atualiza o saldo em tempo real na tela de Contratos (dois navegadores)', async ({
  browser,
}) => {
  // Dois navegadores de Ana (workspace_admin: `contract.manage`/`contract.measure`): um fica parado
  // na tela de Contratos olhando o saldo; o outro cria e aceita a OS no board PMSP (vinculado ao
  // contrato 012/2025). `service_order.changed` invalida `qk.contract(contractId)` em
  // `apps/web/src/realtime/apply.ts`, mas a tela de Contratos lista pelo workspace (`qk.contractsOf`,
  // via `useContracts` em `contracts-page.tsx`) — por isso o saldo só reflete ao vivo se essa chave
  // também for recalculada no recebimento do evento. Este teste verifica exatamente esse requisito
  // (o próprio DoD do projeto: "funciona em tempo real entre dois navegadores").
  const anaContracts = await newUserPage(browser, USERS.ana.email);
  const anaBoard = await newUserPage(browser, USERS.ana.email);

  await openBoard(anaBoard, 'PMSP');
  const workspaceId = workspaceIdFromUrl(anaBoard);

  await gotoContractsPage(anaContracts, workspaceId);
  await contract012Card(anaContracts).click();
  await expect(anaContracts.getByRole('heading', { level: 2, name: /012\/2025/ })).toBeVisible();
  const balance = contractBalanceText(anaContracts);
  await expect(balance).toBeVisible();
  const balanceBefore = await balance.textContent();

  await openServiceOrdersDialog(anaBoard);
  const osNumber = `OS-E2E-${Date.now()}`;
  await createServiceOrder(anaBoard, osNumber);

  // Linha com o Código Edital D1 (UST padrão 40) — sem ajuste manual, quantidade 2 → 80 UST.
  await anaBoard.getByRole('button', { name: 'Adicionar linha', exact: true }).click();
  await anaBoard.getByRole('combobox', { name: 'Código Edital', exact: true }).click();
  await anaBoard.getByRole('option', { name: 'D1 — Diagnóstico', exact: true }).click();
  await anaBoard.getByRole('spinbutton', { name: 'Quantidade', exact: true }).fill('2');
  await expect(anaBoard.getByText('UST/unidade: 40 · UST da linha: 80')).toBeVisible();
  await anaBoard.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(anaBoard.getByText('Linha adicionada à OS.')).toBeVisible();

  // Ciclo completo até "aceita" (único status que consome saldo — critério de aceite 1 da API).
  const transitions = anaBoard.getByRole('group', { name: 'Mudar status da OS' });
  const sequence: readonly string[] = [
    'Solicitar',
    'Emitir',
    'Iniciar execução',
    'Marcar como entregue',
    'Aceitar',
  ];
  for (const [index, label] of sequence.entries()) {
    await transitions.getByRole('button', { name: label, exact: true }).click();
    const next = sequence[index + 1];
    if (next === undefined) {
      await expect(anaBoard.getByRole('dialog').getByText('Aceita', { exact: true })).toBeVisible();
    } else {
      await expect(transitions.getByRole('button', { name: next, exact: true })).toBeVisible();
    }
  }

  // De volta no primeiro navegador, sem recarregar: o saldo deve refletir o consumo de 80 UST.
  await expect(async () => {
    const balanceAfter = await balance.textContent();
    expect(balanceAfter).not.toBe(balanceBefore);
  }).toPass({ timeout: 15_000 });

  await anaContracts.context().close();
  await anaBoard.context().close();
});

test('OS/UST: Código Edital preenche a UST automaticamente; ajuste manual diferente do padrão exige justificativa para salvar', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  await openServiceOrdersDialog(ana);
  await createServiceOrder(ana, `OS-E2E-${Date.now()}`);

  await ana.getByRole('button', { name: 'Adicionar linha', exact: true }).click();
  await ana.getByRole('combobox', { name: 'Código Edital', exact: true }).click();
  await ana.getByRole('option', { name: 'D1 — Diagnóstico', exact: true }).click();

  // Auto-preenchimento: quantidade padrão 1 × UST padrão do catálogo (40), sem qualquer ajuste manual.
  await expect(ana.getByText('UST/unidade: 40 · UST da linha: 40')).toBeVisible();
  await expect(
    ana.getByRole('checkbox', { name: 'Ajustar UST manualmente', exact: true }),
  ).not.toBeChecked();

  // Liga o ajuste manual e muda para um valor diferente do padrão do catálogo.
  await ana.getByRole('checkbox', { name: 'Ajustar UST manualmente', exact: true }).click();
  const ustUnitField = ana.getByRole('spinbutton', { name: 'UST/unidade', exact: true });
  await ustUnitField.fill('45');

  const confirmButton = ana.getByRole('button', { name: 'Adicionar', exact: true });
  // Divergiu do padrão do catálogo (40 → 45): a justificativa é obrigatória e, sem ela, não salva.
  await expect(
    ana.getByRole('textbox', { name: 'Justificativa do ajuste manual da UST', exact: true }),
  ).toBeVisible();
  await expect(confirmButton).toBeDisabled();

  await ana
    .getByRole('textbox', { name: 'Justificativa do ajuste manual da UST', exact: true })
    .fill('Complexidade adicional acordada com o órgão.');
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(ana.getByText('Linha adicionada à OS.')).toBeVisible();

  // A linha persiste o motivo da divergência, visível junto ao Código Edital (auditoria do ajuste).
  await expect(ana.getByText('Complexidade adicional acordada com o órgão.')).toBeVisible();

  await ana.context().close();
});

test('módulo opcional `contracts`: desabilitar no workspace esconde "Contratos" na navegação e o acesso direto pela URL não quebra a aplicação', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  const workspaceId = workspaceIdFromUrl(ana);

  await ana.goto(`/w/${workspaceId}`);
  await expect(ana.getByRole('link', { name: 'Contratos', exact: true })).toBeVisible();

  const openWorkspaceSettings = async (): Promise<void> => {
    await ana.getByRole('button', { name: 'Selecionar workspace' }).click();
    await ana.getByRole('menuitem', { name: 'Configurações do workspace', exact: true }).click();
    await expect(
      ana.getByRole('heading', { level: 1, name: 'Configurações do workspace' }),
    ).toBeVisible();
  };

  await openWorkspaceSettings();
  const contractsToggle = ana.getByRole('checkbox', { name: 'Contratos/OS/UST', exact: true });
  await expect(contractsToggle).toBeChecked();
  await contractsToggle.click();
  await ana.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(ana.getByText('Workspace atualizado.')).toBeVisible();

  try {
    // Navegação: o botão "Contratos" some da página do workspace assim que o módulo é desabilitado.
    await ana.goto(`/w/${workspaceId}`);
    await expect(ana.getByRole('link', { name: 'Contratos', exact: true })).toHaveCount(0);

    // Acesso direto pela URL: o backend passa a devolver 404 para as rotas do módulo (API test já
    // cobre isso); aqui o que importa é que a tela não quebra — segue renderizando seu cabeçalho,
    // sem overlay de erro do Next.js nem exceção não tratada no cliente.
    await ana.goto(`/w/${workspaceId}/contracts`);
    await expect(ana.getByRole('heading', { level: 1, name: 'Contratos' })).toBeVisible();
    await expect(ana.getByText('Application error')).toHaveCount(0);
  } finally {
    // Restaura o módulo: o workspace de demonstração é compartilhado por toda a suíte E2E.
    await openWorkspaceSettings();
    const toggle = ana.getByRole('checkbox', { name: 'Contratos/OS/UST', exact: true });
    if (!(await toggle.isChecked())) {
      await toggle.click();
      await ana.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(ana.getByText('Workspace atualizado.')).toBeVisible();
    }
  }

  await ana.context().close();
});

test('medição e faturamento (critério de aceite 2): gerar, aprovar e faturar a medição do período na tela de Contratos', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  const workspaceId = workspaceIdFromUrl(ana);

  await gotoContractsPage(ana, workspaceId);
  await contract012Card(ana).click();
  await ana.getByRole('tab', { name: 'Medições', exact: true }).click();

  const today = new Date().toISOString().slice(0, 10);
  await ana.getByLabel('Início do período', { exact: true }).fill(today);
  await ana.getByLabel('Fim do período', { exact: true }).fill(today);
  await ana.getByRole('button', { name: 'Gerar medição do período', exact: true }).click();
  await expect(ana.getByText('Medição gerada a partir das OS aceitas do período.')).toBeVisible();

  const measurementRow = ana
    .getByRole('listitem')
    .filter({ hasText: `${today} — ${today}` })
    .first();
  await expect(measurementRow).toBeVisible();
  await expect(measurementRow.getByText('UST medida', { exact: false })).toBeVisible();

  await measurementRow.getByRole('button', { name: 'Aprovar', exact: true }).click();
  await expect(ana.getByText('Medição aprovada.')).toBeVisible();
  await expect(measurementRow.getByText('Aprovada', { exact: true })).toBeVisible();
  await expect(measurementRow.getByText('UST aprovada', { exact: false })).toBeVisible();

  await measurementRow.getByRole('button', { name: 'Faturar', exact: true }).click();
  const invoiceDialog = ana.getByRole('dialog', { name: 'Faturar medição aprovada' });
  const invoiceNumber = `NF-E2E-${Date.now()}`;
  await invoiceDialog
    .getByRole('textbox', { name: 'Número da fatura', exact: true })
    .fill(invoiceNumber);
  await invoiceDialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(ana.getByText('Fatura criada a partir da medição.')).toBeVisible();

  await ana.getByRole('tab', { name: 'Faturas', exact: true }).click();
  const invoiceRow = ana.getByRole('listitem').filter({ hasText: invoiceNumber });
  await expect(invoiceRow).toBeVisible();
  await expect(invoiceRow.getByText('Emitida', { exact: true })).toBeVisible();

  await ana.context().close();
});
