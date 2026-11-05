// k6 run tools/load/items-list.js
//
// Cenário "Tabela com 50 mil itens, 1000 usuários simultâneos" (CLAUDE.md §2.5, Prompt 16):
// rampa de 0 a LOAD_VUS_MAX VUs batendo em `GET /v1/boards/:boardId/items` (paginação por cursor,
// filtro e ordenação reais) contra o board de carga semeado por `pnpm db:seed:large`
// ("Carga — 50 mil itens"). Critério de aceite: p95 < 200 ms.
//
// Autenticação: um token de API pessoal por VU (`ctk_…`, escopo `items:read`/`boards:read`,
// ADR 0056), todos criados em `setup()` — é exatamente o mecanismo que a API pública já expõe
// (`apps/api/src/modules/api-access`), em vez de replicar login/refresh por VU. Um token por VU (não
// um único token compartilhado) é necessário porque cada token tem teto próprio de 300 req/min
// (`API_TOKEN_RATE_LIMIT`, `core/rate-limit/rate-limit.ts`) — com 1000 VUs simultâneas, um único
// token estouraria esse teto quase imediatamente, o que mediria o limitador de taxa, não a API. Em
// produção, 1000 usuários reais têm 1000 contas/tokens distintos; o mesmo vale aqui.
//
// O teto POR USUÁRIO (`RATE_LIMIT_PER_MINUTE`, padrão 600/min, dimensão `user` — todos os tokens
// deste teste pertencem ao mesmo usuário de demonstração) também precisa de folga: suba-o só para a
// duração do teste (`RATE_LIMIT_PER_MINUTE=<alto> pnpm --filter @cube-track/api start`) — documentado
// no README. Isso não contorna o item-level RBAC nem o teto por token; só evita medir "1000 usuários
// de verdade colidem no limite de UM usuário de mentira", que não é o cenário real.
//
// Variáveis de ambiente:
//   API_BASE_URL   URL base da API (padrão http://localhost:3001)
//   API_EMAIL      login de demonstração para criar o token em setup() (padrão da seed)
//   API_PASSWORD   senha de demonstração (padrão da seed)
//   BOARD_NAME     nome do board de carga (padrão "Carga — 50 mil itens", igual ao seed)
//   LOAD_VUS_MAX     pico de VUs simultâneos (padrão 1000)
//   LOAD_RAMP_UP     tempo de rampa de subida (padrão 30s)
//   LOAD_HOLD        tempo no pico (padrão 1m)
//   LOAD_RAMP_DOWN   tempo de rampa de descida (padrão 15s)
//   P95_MS         limiar de p95 em ms (padrão 200, critério do CLAUDE.md)
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE = __ENV.API_BASE_URL ?? 'http://localhost:3001';
const EMAIL = __ENV.API_EMAIL ?? 'ana.ribeiro@empresademo.com.br';
const PASSWORD = __ENV.API_PASSWORD ?? 'CubeTrack@2026';
const BOARD_NAME = __ENV.BOARD_NAME ?? 'Carga — 50 mil itens';
const VUS_MAX = Number(__ENV.LOAD_VUS_MAX ?? 1000);
const RAMP_UP = __ENV.LOAD_RAMP_UP ?? '30s';
const HOLD = __ENV.LOAD_HOLD ?? '1m';
const RAMP_DOWN = __ENV.LOAD_RAMP_DOWN ?? '15s';
const P95_MS = Number(__ENV.P95_MS ?? 200);

const itemsListDuration = new Trend('items_list_duration', true);

// Combinações realistas de filtro/ordenação (board semeado com c_status/c_owner/c_ust/c_prazo/
// c_texto/c_tags — ver packages/db/src/seed/large.ts) — evita que toda VU repita a mesma query
// idêntica (exercita índices por coluna e o GIN jsonb_path_ops em cenários distintos).
const QUERIES = new SharedArray('queries', () => [
  { sort: 'c_ust:desc' },
  { sort: 'name:asc' },
  { sort: 'c_prazo:asc' },
  { sort: 'c_ust:desc', filter: { op: 'and', conditions: [{ field: 'c_tags', operator: 'any_of', value: ['lote-0'] }] } },
  { sort: 'c_prazo:asc', filter: { op: 'and', conditions: [{ field: 'c_tags', operator: 'any_of', value: ['lote-3'] }] } },
  { filter: { op: 'and', conditions: [{ field: 'c_texto', operator: 'contains', value: 'carga número 1' }] } },
]);

export const options = {
  scenarios: {
    items_list: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: VUS_MAX },
        { duration: HOLD, target: VUS_MAX },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // Critério do CLAUDE.md: p95 da API < 200 ms. `http_req_failed` cobre erros de rede/5xx/429.
    items_list_duration: [`p(95)<${P95_MS}`],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (login.status !== 200) {
    throw new Error(`Login de demonstração falhou (${login.status}): ${login.body}`);
  }
  const accessToken = login.json('accessToken');

  // Um token por VU (ver nota de autenticação acima) — criados sequencialmente aqui, de uma vez,
  // nunca durante o teste em si.
  const tokens = [];
  const tokenIds = [];
  for (let i = 0; i < VUS_MAX; i += 1) {
    const tokenRes = http.post(
      `${BASE}/v1/me/tokens`,
      JSON.stringify({
        name: `k6-items-list-${Date.now()}-${i}`,
        scopes: ['items:read', 'boards:read'],
      }),
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } },
    );
    if (tokenRes.status !== 201) {
      throw new Error(`Criação do token de API falhou (${tokenRes.status}): ${tokenRes.body}`);
    }
    tokens.push(tokenRes.json('token'));
    tokenIds.push(tokenRes.json('id'));
  }
  const apiToken = tokens[0];

  const workspaces = http.get(`${BASE}/v1/workspaces`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (workspaces.status !== 200) {
    throw new Error(`Listar workspaces falhou (${workspaces.status}): ${workspaces.body}`);
  }
  let boardId = null;
  for (const workspace of workspaces.json('data')) {
    const boards = http.get(`${BASE}/v1/workspaces/${workspace.id}/boards`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const found = (boards.json('data') ?? []).find((board) => board.name === BOARD_NAME);
    if (found !== undefined) {
      boardId = found.id;
      break;
    }
  }
  if (boardId === null) {
    throw new Error(
      `Board "${BOARD_NAME}" não encontrado — rode "pnpm db:seed && pnpm db:seed:large" antes.`,
    );
  }
  return { accessToken, tokens, tokenIds, boardId };
}

export default function (data) {
  const vuIndex = (exec.vu.idInTest - 1) % data.tokens.length;
  const apiToken = data.tokens[vuIndex];
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const params = { limit: '50' };
  if (query.sort !== undefined) params.sort = query.sort;
  if (query.filter !== undefined) params.filter = JSON.stringify(query.filter);
  const qs = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const res = http.get(`${BASE}/v1/boards/${data.boardId}/items?${qs}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
    tags: { name: 'items_list' },
  });
  itemsListDuration.add(res.timings.duration);
  check(res, {
    'status é 200': (r) => r.status === 200,
    'tem dados paginados': (r) => Array.isArray(r.json('data')),
  });
}

export function teardown(data) {
  // Revoga os tokens de carga — não deixa credenciais de teste penduradas no tenant de demonstração.
  // Relogar em vez de reusar `data.accessToken`: a sessão expira em 10 min (padrão da API) e um teste
  // longo (rampa + pico + descida) pode ultrapassar isso.
  const login = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const accessToken = login.status === 200 ? login.json('accessToken') : data.accessToken;
  for (const tokenId of data.tokenIds) {
    http.del(`${BASE}/v1/me/tokens/${tokenId}`, null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
}

export function handleSummary(data) {
  const p95 = data.metrics.items_list_duration?.values?.['p(95)'] ?? null;
  const passed = p95 !== null && p95 < P95_MS;
  const summary = {
    scenario: 'items-list',
    boardName: BOARD_NAME,
    vusMax: VUS_MAX,
    p95ThresholdMs: P95_MS,
    measured: {
      p95Ms: p95,
      p50Ms: data.metrics.items_list_duration?.values?.['med'] ?? null,
      maxMs: data.metrics.items_list_duration?.values?.['max'] ?? null,
      requests: data.metrics.http_reqs?.values?.count ?? null,
      httpReqFailedRate: data.metrics.http_req_failed?.values?.rate ?? null,
    },
    passed,
  };
  const lines = [
    `items-list: ${String(summary.measured.requests)} requisições, ${String(VUS_MAX)} VUs de pico`,
    `  p50=${String(summary.measured.p50Ms)}ms  p95=${String(p95)}ms (limite ${String(P95_MS)}ms)  max=${String(summary.measured.maxMs)}ms`,
    `  http_req_failed=${String(summary.measured.httpReqFailedRate)}`,
    passed ? '  RESULTADO: PASSOU (p95 < limite)' : '  RESULTADO: FALHOU (p95 >= limite ou sem amostras)',
  ];
  return {
    stdout: `${lines.join('\n')}\n`,
    'tools/load/results/items-list-summary.json': `${JSON.stringify(summary, null, 2)}\n`,
  };
}
