// k6 run tools/load/realtime.js
//
// Cenário "propagação em tempo real < 300 ms" (CLAUDE.md §2.3, Prompt 16): um grupo de VUs mantém
// uma conexão Socket.IO inscrita no board de carga ("Carga — 50 mil itens") enquanto outro grupo
// muda itens via REST; mede-se o tempo entre a ocorrência do evento (`occurredAt`, gravado pela API
// na mesma transação da mudança) e o recebimento pelo socket assinante. O mesmo cálculo é o que a
// API já expõe como histograma Prometheus `cube_realtime_propagation_ms`
// (apps/api/src/core/observability/metrics.ts) — este script relata os dois números lado a lado
// (ver `tools/load/scrape-metrics.sh`) para validação cruzada: a diferença entre eles é,
// essencialmente, o tempo de rede até o VU (a métrica do servidor já cobre ocorrência → emissão do
// socket; o cliente cobre ocorrência → recebimento).
//
// Protocolo: k6 não tem cliente Socket.IO embutido, então o script fala Engine.IO/Socket.IO v4
// diretamente sobre `k6/ws` (handshake de abertura, pacote CONNECT com `auth.token` no payload,
// pacote EVENT para `subscribe`, pong de keep-alive) — ver `apps/api/src/modules/realtime/
// realtime.gateway.ts` para o lado do servidor.
//
// Variáveis de ambiente:
//   API_BASE_URL     URL base HTTP (padrão http://localhost:3001)
//   WS_BASE_URL      URL base WS (padrão derivada de API_BASE_URL trocando http->ws)
//   API_EMAIL/API_PASSWORD  login de demonstração (padrão da seed)
//   BOARD_NAME       nome do board de carga (padrão "Carga — 50 mil itens")
//   LOAD_SUBSCRIBERS   nº de sockets assinantes simultâneos (padrão 20)
//   LOAD_MUTATORS      nº de VUs que mutam itens via REST (padrão 5)
//   LOAD_DURATION      duração do cenário (padrão 30s)
//   P300_MS          limiar de p95 em ms (padrão 300, critério do CLAUDE.md)
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const API_BASE = __ENV.API_BASE_URL ?? 'http://localhost:3001';
const WS_BASE = __ENV.WS_BASE_URL ?? API_BASE.replace(/^http/, 'ws');
const EMAIL = __ENV.API_EMAIL ?? 'ana.ribeiro@empresademo.com.br';
const PASSWORD = __ENV.API_PASSWORD ?? 'CubeTrack@2026';
const BOARD_NAME = __ENV.BOARD_NAME ?? 'Carga — 50 mil itens';
const SUBSCRIBERS = Number(__ENV.LOAD_SUBSCRIBERS ?? 20);
const MUTATORS = Number(__ENV.LOAD_MUTATORS ?? 5);
const DURATION = __ENV.LOAD_DURATION ?? '30s';
const DURATION_MS = parseDurationMs(DURATION);
const P300_MS = Number(__ENV.P300_MS ?? 300);

const propagationMs = new Trend('realtime_propagation_ms', true);
const eventsReceived = new Counter('realtime_events_received');
const mutationsSent = new Counter('realtime_mutations_sent');

export const options = {
  scenarios: {
    subscribers: {
      executor: 'per-vu-iterations',
      vus: SUBSCRIBERS,
      iterations: 1,
      maxDuration: `${Math.ceil(DURATION_MS / 1000) + 30}s`,
      exec: 'subscribe',
    },
    mutators: {
      executor: 'constant-vus',
      vus: MUTATORS,
      duration: DURATION,
      exec: 'mutate',
      startTime: '2s', // dá tempo dos assinantes conectarem e se inscreverem antes da 1ª mutação.
    },
  },
  thresholds: {
    realtime_propagation_ms: [`p(95)<${P300_MS}`],
  },
};

function parseDurationMs(value) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (match === null) return 30000;
  const n = Number(match[1]);
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]];
  return n * unit;
}

export function setup() {
  const login = http.post(
    `${API_BASE}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (login.status !== 200) throw new Error(`Login falhou (${login.status}): ${login.body}`);
  const accessToken = login.json('accessToken');

  const tokenRes = http.post(
    `${API_BASE}/v1/me/tokens`,
    JSON.stringify({
      name: `k6-realtime-${Date.now()}`,
      scopes: ['items:read', 'items:write', 'boards:read'],
    }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } },
  );
  if (tokenRes.status !== 201) throw new Error(`Criar token falhou (${tokenRes.status}): ${tokenRes.body}`);
  const apiToken = tokenRes.json('token');
  const tokenId = tokenRes.json('id');

  const workspaces = http.get(`${API_BASE}/v1/workspaces`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  let boardId = null;
  for (const workspace of workspaces.json('data')) {
    const boards = http.get(`${API_BASE}/v1/workspaces/${workspace.id}/boards`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const found = (boards.json('data') ?? []).find((board) => board.name === BOARD_NAME);
    if (found !== undefined) {
      boardId = found.id;
      break;
    }
  }
  if (boardId === null) {
    throw new Error(`Board "${BOARD_NAME}" não encontrado — rode "pnpm db:seed:large" antes.`);
  }

  // Alvos de mutação: um item distinto por mutator (evita LWW pisando na mesma linha sem necessidade).
  const itemsRes = http.get(`${API_BASE}/v1/boards/${boardId}/items?limit=${MUTATORS}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const itemIds = (itemsRes.json('data') ?? []).map((item) => item.id);
  if (itemIds.length === 0) throw new Error('Board de carga sem itens — rode "pnpm db:seed:large".');

  return { accessToken, apiToken, tokenId, boardId, itemIds };
}

// k6 exige um export `default`, mesmo com todo cenário usando `exec` próprio — nunca chamado aqui.
export default function () {}

/** VUs assinantes: um WebSocket cada, falando Engine.IO/Socket.IO v4 diretamente (sem lib cliente). */
export function subscribe(data) {
  const url = `${WS_BASE}/socket.io/?EIO=4&transport=websocket`;
  const res = ws.connect(url, {}, function (socket) {
    let subscribed = false;
    socket.on('message', function (msg) {
      if (msg === '2') {
        socket.send('3'); // pong do Engine.IO
        return;
      }
      if (msg.length > 0 && msg[0] === '0') {
        // Engine.IO "open" — conecta o namespace padrão com o access token no payload de auth.
        socket.send(`40${JSON.stringify({ token: data.accessToken })}`);
        return;
      }
      if (msg.indexOf('40') === 0 && !subscribed) {
        subscribed = true;
        socket.send(`420${JSON.stringify(['subscribe', { room: 'board', id: data.boardId }])}`);
        return;
      }
      if (msg.indexOf('42') === 0) {
        const payload = parseSocketIoEvent(msg);
        if (payload === null) return;
        const [eventName, body] = payload;
        if (eventName === 'event' && body?.scope?.boardId === data.boardId) {
          const occurredAt = Date.parse(body.occurredAt);
          if (!Number.isNaN(occurredAt)) {
            propagationMs.add(Date.now() - occurredAt);
            eventsReceived.add(1);
          }
        }
      }
    });
    socket.on('error', function () {
      /* registrado via check() abaixo (status da conexão) */
    });
    socket.setTimeout(function () {
      socket.close();
    }, DURATION_MS + 10000);
  });
  check(res, { 'conexão WS estabelecida (101)': (r) => r !== null && r.status === 101 });
}

/** VUs mutadores: PATCH periódico num item do board de carga, via API REST normal. */
export function mutate(data) {
  const itemId = data.itemIds[Math.floor(Math.random() * data.itemIds.length)];
  const res = http.patch(
    `${API_BASE}/v1/items/${itemId}`,
    JSON.stringify({ values: { c_texto: { text: `k6 realtime ${Date.now()}` } } }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.apiToken}` },
      tags: { name: 'item_mutation' },
    },
  );
  check(res, { 'mutação aceita (200)': (r) => r.status === 200 });
  mutationsSent.add(1);
  sleep(0.5);
}

function parseSocketIoEvent(raw) {
  // "42[...]" (sem id de ack — eventos do servidor para o cliente não pedem ack).
  const body = raw.slice(2);
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function teardown(data) {
  const login = http.post(
    `${API_BASE}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const accessToken = login.status === 200 ? login.json('accessToken') : data.accessToken;
  http.del(`${API_BASE}/v1/me/tokens/${data.tokenId}`, null, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function handleSummary(data) {
  const eventsReceived = data.metrics.realtime_events_received?.values?.count ?? 0;
  const p95 = data.metrics.realtime_propagation_ms?.values?.['p(95)'] ?? null;
  const passed = eventsReceived > 0 && p95 !== null && p95 < P300_MS;
  const summary = {
    scenario: 'realtime-propagation',
    boardName: BOARD_NAME,
    subscribers: SUBSCRIBERS,
    mutators: MUTATORS,
    p95ThresholdMs: P300_MS,
    measured: {
      p95Ms: p95,
      p50Ms: data.metrics.realtime_propagation_ms?.values?.med ?? null,
      maxMs: data.metrics.realtime_propagation_ms?.values?.max ?? null,
      eventsReceived: data.metrics.realtime_events_received?.values?.count ?? 0,
      mutationsSent: data.metrics.realtime_mutations_sent?.values?.count ?? 0,
    },
    passed,
    note:
      'Cruze este p95 (lado cliente, inclui rede até o VU) com o histograma Prometheus ' +
      'cube_realtime_propagation_ms (lado servidor) via tools/load/scrape-metrics.sh — ver README.',
  };
  const lines = [
    `realtime: ${String(summary.measured.eventsReceived)} eventos recebidos, ` +
      `${String(summary.measured.mutationsSent)} mutações enviadas (${String(SUBSCRIBERS)} assinantes, ${String(MUTATORS)} mutadores)`,
    `  p50=${String(summary.measured.p50Ms)}ms  p95=${String(p95)}ms (limite ${String(P300_MS)}ms)  max=${String(summary.measured.maxMs)}ms`,
    passed ? '  RESULTADO: PASSOU (p95 < limite)' : '  RESULTADO: FALHOU (p95 >= limite ou sem amostras)',
  ];
  return {
    stdout: `${lines.join('\n')}\n`,
    'tools/load/results/realtime-summary.json': `${JSON.stringify(summary, null, 2)}\n`,
  };
}
