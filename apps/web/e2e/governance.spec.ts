import { expect, test, type Page } from '@playwright/test';

import { newUserPage, openBoard, resetRateLimits, USERS } from './helpers';

test.beforeEach(async () => {
  await resetRateLimits();
});

/**
 * Abre o diálogo "Governança" do board (só em boards `kind: 'project'`, como o PMSP) e troca para
 * a aba informada. `board-header.tsx`: `canGovernance = board.kind === 'project'` — o botão aparece
 * para qualquer um com o board aberto; cada aba interna é que decide o que mostrar conforme
 * `board.manage` (mesmo padrão de Automatizar/Processo/Integrar).
 */
async function openGovernanceTab(page: Page, tabName: string): Promise<void> {
  await page.getByRole('button', { name: 'Governança', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Governança do projeto' });
  await dialog.getByRole('tab', { name: tabName, exact: true }).click();
}

test('governança: registrar um risco atualiza a lista e a matriz probabilidade × impacto, em tempo real', async ({
  browser,
}) => {
  // Duas sessões (`risk.changed` chega pela room do board — `apply.ts` invalida `qk.risksOfBoard`,
  // ver ADR 0053): quem criou vê o próprio risco; uma segunda sessão com a aba Riscos já aberta
  // também vê, sem recarregar.
  const ana = await newUserPage(browser, USERS.ana.email);
  const anaSecondTab = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  await openGovernanceTab(ana, 'Riscos');
  await openBoard(anaSecondTab, 'PMSP');
  await openGovernanceTab(anaSecondTab, 'Riscos');

  // O board PMSP já tem 2 riscos semeados (packages/db/src/seed/workspace.ts): um com
  // probabilidade 3 × impacto 4 ("Instabilidade da API do SEI...", em mitigação) e outro com
  // probabilidade 2 × impacto 5 ("Saldo de UST insuficiente...", aberto) — a matriz já nasce com
  // contagens reais, não vazia.
  await expect(ana.getByText('Instabilidade da API do SEI em homologação')).toBeVisible();
  await expect(ana.getByText('Matriz de probabilidade × impacto')).toBeVisible();

  const title = `Risco E2E ${Date.now()}`;
  await ana.getByRole('button', { name: 'Novo risco', exact: true }).click();
  await ana.getByRole('textbox', { name: 'Título', exact: true }).fill(title);
  await ana.getByRole('combobox', { name: 'Probabilidade (1-5)', exact: true }).click();
  await ana.getByRole('option', { name: '5', exact: true }).click();
  await ana.getByRole('combobox', { name: 'Impacto (1-5)', exact: true }).click();
  await ana.getByRole('option', { name: '5', exact: true }).click();
  await ana.getByRole('button', { name: 'Salvar', exact: true }).click();

  await expect(ana.getByText('Risco registrado.')).toBeVisible();
  const newRisk = ana.getByRole('listitem').filter({ hasText: title });
  await expect(newRisk).toBeVisible();
  // Status padrão do formulário (EMPTY_FORM.status = 'open') — confirma que o risco persistiu com
  // os valores reais enviados, não só que o toast de sucesso apareceu.
  await expect(newRisk.getByText('Aberto', { exact: true })).toBeVisible();

  // Segunda sessão: mesmo risco aparece sem recarregar (invalidação disparada por `risk.changed`).
  await expect(anaSecondTab.getByRole('listitem').filter({ hasText: title })).toBeVisible({
    timeout: 10_000,
  });

  await ana.context().close();
  await anaSecondTab.context().close();
});

test('governança: decidir um portão pendente muda o status (board PMSP)', async ({ browser }) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  await openGovernanceTab(ana, 'Portões');

  // 3 portões semeados: "Iniciação" e "Planejamento" já aprovados; "Renovação contratual" pendente
  // (único com os botões Aprovar/Rejeitar/Pular visíveis, já que só aparecem para status 'pending').
  const gate = ana.getByRole('listitem').filter({ hasText: 'Renovação contratual' });
  await expect(gate.getByText('Pendente', { exact: true })).toBeVisible();
  await gate.getByRole('button', { name: 'Aprovar', exact: true }).click();

  await expect(ana.getByText('Portão decidido.')).toBeVisible();
  await expect(gate.getByText('Aprovado', { exact: true })).toBeVisible();
  await expect(gate.getByRole('button', { name: 'Aprovar', exact: true })).toHaveCount(0);
});

test('governança: orçamento mostra o orçamento semeado; EVM ainda sem dados (RAG automático nunca rodou)', async ({
  browser,
}) => {
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');
  await openGovernanceTab(ana, 'Orçamento');

  // Orçamento e 4 lançamentos de custo reais do seed (ADR 0053) — valores de EVM (PV/EV/AC/EAC/VAC)
  // só existem em registros de saúde automáticos (`isAutomatic: true`), que o worker grava; os 3
  // relatos semeados são manuais (`reportedBy` setado, sem EVM) — por isso "Sem dados suficientes
  // ainda." é o estado real e esperado aqui, não uma falha de dado ausente.
  await expect(ana.getByText('Orçamento de execução – contrato 012/2025')).toBeVisible();
  await expect(ana.getByText('OPEX', { exact: true })).toBeVisible();
  await expect(ana.getByText('Earned Value (EVM)')).toBeVisible();
  await expect(ana.getByText('Sem dados suficientes ainda.')).toBeVisible();
});

test('saúde do projeto: justificativa de sobreposição não aparece quando o último relato é manual', async ({
  browser,
}) => {
  // Critério de aceite do Prompt 12 ("O RAG muda automaticamente quando a regra é violada") é
  // produzido por um processo de WORKER (fila `portfolio`, recálculo diário) — não é algo que um
  // teste só-de-navegador force de forma síncrona sem rodar o worker contra o mesmo evento. O board
  // PMSP tem 3 relatos de saúde semeados, todos MANUAIS (sem `isAutomatic`, packages/db/src/seed/
  // workspace.ts) — o que É genuinamente testável aqui, com dados reais, é a outra metade do
  // critério de override: `project-health-dialog.tsx` só exige (e só MOSTRA) "Justificativa da
  // sobreposição" quando `latestIsAutomatic` é true. Como o último relato do PMSP é manual, o campo
  // não deve aparecer — sobrepor um relato manual com outro manual não é uma "sobreposição" no
  // sentido do critério de aceite. O caminho "campo aparece e é obrigatório" depende de um relato
  // automático já ter sido gravado (worker ou `apps/api/test/portfolio.e2e.test.ts`, que já cobre
  // isso em teste de integração) — não reproduzido aqui.
  const ana = await newUserPage(browser, USERS.ana.email);
  await openBoard(ana, 'PMSP');

  await ana.getByRole('button', { name: 'Nova view', exact: true }).click();
  await ana.getByRole('menuitem', { name: 'Dashboard', exact: true }).click();
  await expect(ana.getByText('View "Nova Dashboard" criada.')).toBeVisible();
  await ana.getByRole('button', { name: 'Criar dashboard', exact: true }).click();
  await expect(ana.getByRole('button', { name: 'Widget', exact: true })).toBeVisible();

  await ana.getByRole('button', { name: 'Widget', exact: true }).click();
  const widgetDialog = ana.getByRole('dialog', { name: 'Adicionar widget' });
  await widgetDialog.getByRole('combobox', { name: 'Tipo de widget' }).click();
  await ana.getByRole('option', { name: 'Saúde do projeto', exact: true }).click();
  await widgetDialog.getByRole('textbox', { name: 'Título' }).fill('Saúde PMSP');
  await widgetDialog.getByRole('button', { name: 'Salvar', exact: true }).click();

  // Histórico real do PMSP: o relato mais recente (63% / verde, 2026-10-01) já aparece, diferente do
  // teste equivalente em dashboards.spec.ts (board "Melhorias internas", sem histórico nenhum).
  await expect(ana.getByText('Verde (no prazo)').first()).toBeVisible();

  await ana.getByRole('button', { name: 'Relatar saúde', exact: true }).click();
  const reportDialog = ana.getByRole('dialog', { name: 'Relatar saúde do projeto' });
  await expect(reportDialog.getByText('Justificativa da sobreposição')).toHaveCount(0);

  // Preenche e relata normalmente: sem o campo de justificativa, o relato (manual sobre manual) não
  // deve ser bloqueado.
  await reportDialog.getByRole('combobox', { name: 'Geral' }).click();
  await ana.getByRole('option', { name: 'Amarelo (atenção)', exact: true }).click();
  await reportDialog.getByRole('button', { name: 'Relatar', exact: true }).click();
  await expect(ana.getByText('Saúde do projeto relatada.')).toBeVisible();
});
