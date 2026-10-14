/**
 * Lighthouse nas telas base (login, Início, board, Minha semana) — perfis mobile (padrão, com
 * throttling) e desktop. A sessão é aberta pela UI num Chromium com depuração remota e o Lighthouse
 * reutiliza o mesmo navegador (o refresh token rotativo não pode ser reaproveitado por cookie).
 *
 * Uso: node scripts/lighthouse.mjs [baseUrl] — requer API e web em execução (modo produção).
 * Saída: lighthouse/summary.json e relatórios HTML por tela.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const PORT = 9333;
const MIN_SCORE = 90;
const out = join(process.cwd(), 'lighthouse');
await mkdir(out, { recursive: true });

const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'ct-lh-')), {
  args: [`--remote-debugging-port=${PORT}`],
  locale: 'pt-BR',
});
const page = context.pages()[0] ?? (await context.newPage());

async function audit(name, url, formFactor) {
  const flags = {
    port: PORT,
    output: 'html',
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices'],
  };
  const result = await lighthouse(url, flags, formFactor === 'desktop' ? desktopConfig : undefined);
  if (result === undefined) throw new Error(`Lighthouse sem resultado para ${url}`);
  await writeFile(join(out, `${name}-${formFactor}.html`), String(result.report));
  await writeFile(join(out, `${name}-${formFactor}.json`), JSON.stringify(result.lhr));
  const scores = Object.fromEntries(
    Object.entries(result.lhr.categories).map(([key, category]) => [
      key,
      Math.round((category.score ?? 0) * 100),
    ]),
  );
  const metrics = {
    lcpMs: Math.round(result.lhr.audits['largest-contentful-paint']?.numericValue ?? 0),
    tbtMs: Math.round(result.lhr.audits['total-blocking-time']?.numericValue ?? 0),
    cls: Number((result.lhr.audits['cumulative-layout-shift']?.numericValue ?? 0).toFixed(3)),
  };
  console.info(
    `${name.padEnd(10)} ${formFactor.padEnd(7)} perf=${scores.performance} a11y=${scores.accessibility} bp=${scores['best-practices']} lcp=${metrics.lcpMs}ms tbt=${metrics.tbtMs}ms cls=${metrics.cls}`,
  );
  return { name, formFactor, url, scores, metrics };
}

const results = [];
for (const formFactor of ['mobile', 'desktop'])
  results.push(await audit('login', `${BASE}/login`, formFactor));

await page.goto(`${BASE}/login`);
await page.getByLabel('E-mail').fill(process.env.LH_EMAIL ?? 'ana.ribeiro@empresademo.com.br');
await page.getByLabel('Senha').fill(process.env.LH_PASSWORD ?? 'CubeTrack@2026');
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.waitForURL((url) => !url.pathname.startsWith('/login'));
const boardLink = page
  .getByRole('list', { name: 'Boards' })
  .getByRole('link', { name: 'PMSP', exact: true });
await boardLink.waitFor();
const boardUrl = new URL((await boardLink.getAttribute('href')) ?? '/', BASE).toString();

for (const formFactor of ['mobile', 'desktop']) {
  results.push(await audit('home', `${BASE}/`, formFactor));
  results.push(await audit('board', boardUrl, formFactor));
  results.push(await audit('my-week', `${BASE}/my-week`, formFactor));
}

await writeFile(join(out, 'summary.json'), `${JSON.stringify(results, null, 2)}\n`);
await context.close();

const failing = results.filter(
  (entry) => entry.scores.performance < MIN_SCORE || entry.scores.accessibility < MIN_SCORE,
);
if (failing.length > 0) {
  console.error(
    `Abaixo de ${MIN_SCORE}: ${failing.map((entry) => `${entry.name}/${entry.formFactor}`).join(', ')}`,
  );
  process.exitCode = 1;
}
