import type { RealtimeEvent } from '@cube-track/shared';
import { PRESENCE_HEARTBEAT_SECONDS } from '@cube-track/shared/realtime';
import type { QueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';

import { api } from '@/lib/api/client';
import { qk } from '@/lib/query/keys';

import { applyRealtimeEvent, type ApplyContext } from './apply';
import {
  clearRoomPresence,
  realtimeStore,
  removePresence,
  setPresence,
  upsertPresence,
  type PresenceEntry,
} from './store';

const DEDUPE_SIZE = 5_000;

/** Pode ser assíncrona: o provider carrega `socket.io-client` sob demanda (fora do bundle inicial). */
export type SocketFactory = (token: string) => Socket | Promise<Socket>;

interface BoardSubscription {
  refs: number;
  /** Última sequência aplicada (null até conhecer a base pelo GET do board). */
  lastSeq: number | null;
  room: string | null;
  presenceState: Record<string, unknown>;
}

interface SubscribeAck {
  ok: boolean;
  room?: string;
  presence?: PresenceEntry[];
  replay?: { events: RealtimeEvent[]; resyncRequired: boolean; seq: number };
  error?: { code: string };
}

interface ItemSubscription {
  refs: number;
  room: string | null;
  presenceState: Record<string, unknown>;
}

/**
 * Cliente realtime: uma conexão Socket.IO por aba, assinaturas de board com contagem de referências,
 * aplicação ordenada por `seq` (lacuna → replay; replay impossível → resync), deduplicação por
 * `eventId`, presença com heartbeat e reconexão com backoff exponencial + jitter (ADR 0033).
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private readonly boards = new Map<string, BoardSubscription>();
  private readonly items = new Map<string, ItemSubscription>();
  private readonly seen = new Set<string>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly replaying = new Set<string>();
  /** Incrementa a cada start/stop: descarta sockets criados por um start já cancelado. */
  private generation = 0;
  private starting = false;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly createSocket: SocketFactory,
    private readonly context: ApplyContext,
  ) {}

  start(token: string): void {
    if (this.socket !== null || this.starting) return;
    this.starting = true;
    const generation = ++this.generation;
    realtimeStore.setState({ status: 'connecting' });
    void Promise.resolve(this.createSocket(token)).then(
      (socket) => {
        if (generation !== this.generation) {
          socket.disconnect();
          return;
        }
        this.starting = false;
        this.attach(socket);
      },
      () => {
        if (generation !== this.generation) return;
        this.starting = false;
        realtimeStore.setState({ status: 'offline' });
      },
    );
  }

  private attach(socket: Socket): void {
    this.socket = socket;
    socket.on('ready', () => {
      realtimeStore.setState({ status: 'online' });
      for (const boardId of this.boards.keys()) void this.subscribe(boardId);
      for (const itemId of this.items.keys()) void this.subscribeItem(itemId);
    });
    socket.on('disconnect', () => {
      realtimeStore.setState({ status: 'offline' });
    });
    socket.io.on('reconnect_attempt', () => {
      realtimeStore.setState({ status: 'connecting' });
    });
    socket.on('connect_error', () => {
      realtimeStore.setState({ status: 'offline' });
    });
    socket.on('auth_error', () => {
      realtimeStore.setState({ status: 'offline' });
    });
    socket.on('event', (event: RealtimeEvent) => {
      this.handle(event);
    });
    this.heartbeat = setInterval(() => {
      this.beatAll();
    }, PRESENCE_HEARTBEAT_SECONDS * 1000);
  }

  stop(): void {
    this.generation += 1;
    this.starting = false;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.boards.clear();
    this.items.clear();
    this.seen.clear();
    realtimeStore.setState({ status: 'idle', presence: {} });
  }

  /** Novo access token após refresh: o socket aberto é reautenticado sem reconectar. */
  updateToken(token: string): void {
    const socket = this.socket;
    if (socket === null) return;
    socket.auth = { token };
    if (socket.connected) socket.emit('auth.refresh', { token });
  }

  /** Passa a receber eventos e presença de um board; devolve a função para liberar. */
  watchBoard(boardId: string, presenceState: Record<string, unknown> = {}): () => void {
    const existing = this.boards.get(boardId);
    if (existing !== undefined) {
      existing.refs += 1;
      existing.presenceState = presenceState;
    } else {
      this.boards.set(boardId, { refs: 1, lastSeq: null, room: null, presenceState });
      if (this.socket?.connected === true) void this.subscribe(boardId);
    }
    return () => {
      this.unwatchBoard(boardId);
    };
  }

  /** Base de sequência vinda do GET do board (dados já refletem até `seq`). */
  setBaseline(boardId: string, seq: number): void {
    const subscription = this.boards.get(boardId);
    if (
      subscription !== undefined &&
      (subscription.lastSeq === null || seq > subscription.lastSeq)
    ) {
      subscription.lastSeq = seq;
    }
  }

  /** Atualiza o estado de presença (ex.: view aberta) e envia na hora. */
  setPresenceState(boardId: string, state: Record<string, unknown>): void {
    const subscription = this.boards.get(boardId);
    if (subscription === undefined) return;
    subscription.presenceState = state;
    this.beat(boardId);
  }

  /**
   * Presença da room de um item (quem tem o painel aberto): sem replay/seq, só presença — os
   * eventos do item (atualizações, checklist…) já chegam pela room do board, sempre assistida
   * enquanto o painel está aberto sobre a página do board.
   */
  watchItem(itemId: string, presenceState: Record<string, unknown> = {}): () => void {
    const existing = this.items.get(itemId);
    if (existing !== undefined) {
      existing.refs += 1;
      existing.presenceState = presenceState;
    } else {
      this.items.set(itemId, { refs: 1, room: null, presenceState });
      if (this.socket?.connected === true) void this.subscribeItem(itemId);
    }
    return () => {
      this.unwatchItem(itemId);
    };
  }

  setItemPresenceState(itemId: string, state: Record<string, unknown>): void {
    const subscription = this.items.get(itemId);
    if (subscription === undefined) return;
    subscription.presenceState = state;
    this.beatItem(itemId);
  }

  private unwatchItem(itemId: string): void {
    const subscription = this.items.get(itemId);
    if (subscription === undefined) return;
    subscription.refs -= 1;
    if (subscription.refs > 0) return;
    this.items.delete(itemId);
    if (subscription.room !== null) clearRoomPresence(subscription.room);
    if (this.socket?.connected === true) this.socket.emit('unsubscribe', { room: 'item', id: itemId });
  }

  private async subscribeItem(itemId: string): Promise<void> {
    const socket = this.socket;
    const subscription = this.items.get(itemId);
    if (socket === null || subscription === undefined) return;
    try {
      const ack = (await socket
        .timeout(10_000)
        .emitWithAck('subscribe', { room: 'item', id: itemId })) as SubscribeAck;
      if (!ack.ok || ack.room === undefined) return;
      subscription.room = ack.room;
      setPresence(ack.room, ack.presence ?? []);
      this.beatItem(itemId);
    } catch {
      // Sem ack (timeout): a próxima reconexão tenta de novo.
    }
  }

  private beatItem(itemId: string): void {
    const subscription = this.items.get(itemId);
    if (subscription?.room === null || subscription === undefined || this.socket?.connected !== true) return;
    this.socket.emit('presence.heartbeat', { room: 'item', id: itemId, state: subscription.presenceState });
  }

  private unwatchBoard(boardId: string): void {
    const subscription = this.boards.get(boardId);
    if (subscription === undefined) return;
    subscription.refs -= 1;
    if (subscription.refs > 0) return;
    this.boards.delete(boardId);
    if (subscription.room !== null) clearRoomPresence(subscription.room);
    if (this.socket?.connected === true)
      this.socket.emit('unsubscribe', { room: 'board', id: boardId });
  }

  private async subscribe(boardId: string): Promise<void> {
    const socket = this.socket;
    const subscription = this.boards.get(boardId);
    if (socket === null || subscription === undefined) return;
    try {
      const ack = (await socket.timeout(10_000).emitWithAck('subscribe', {
        room: 'board',
        id: boardId,
        ...(subscription.lastSeq === null ? {} : { lastSeq: subscription.lastSeq }),
      })) as SubscribeAck;
      if (!ack.ok || ack.room === undefined) return;
      subscription.room = ack.room;
      setPresence(ack.room, ack.presence ?? []);
      if (ack.replay !== undefined) this.applyReplay(boardId, ack.replay);
      this.beat(boardId);
    } catch {
      // Sem ack (timeout): a próxima reconexão tenta de novo.
    }
  }

  private applyReplay(boardId: string, replay: NonNullable<SubscribeAck['replay']>): void {
    const subscription = this.boards.get(boardId);
    if (subscription === undefined) return;
    if (replay.resyncRequired) {
      subscription.lastSeq = replay.seq;
      void this.queryClient.invalidateQueries({ queryKey: qk.board(boardId) });
      return;
    }
    for (const event of replay.events) this.handle(event);
    subscription.lastSeq = Math.max(subscription.lastSeq ?? 0, replay.seq);
  }

  private remember(eventId: string): boolean {
    if (this.seen.has(eventId)) return false;
    this.seen.add(eventId);
    if (this.seen.size > DEDUPE_SIZE) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  /** Entrada única de eventos (socket e replay). */
  handle(event: RealtimeEvent): void {
    if (event.type === 'presence.joined' || event.type === 'presence.updated') {
      const payload = event.payload as {
        room: string;
        userId: string;
        state: Record<string, unknown>;
      };
      upsertPresence(payload.room, { userId: payload.userId, state: payload.state });
      return;
    }
    if (event.type === 'presence.left') {
      const payload = event.payload as { room: string; userId: string };
      removePresence(payload.room, payload.userId);
      return;
    }
    if (!this.remember(event.eventId)) return;
    const boardId = event.scope.boardId;
    const subscription = boardId === null ? undefined : this.boards.get(boardId);
    if (boardId !== null && subscription !== undefined && event.seq !== null) {
      if (subscription.lastSeq !== null) {
        if (event.seq <= subscription.lastSeq) return;
        if (event.seq > subscription.lastSeq + 1) {
          // Lacuna: busca os eventos faltantes (inclui este) e aplica em ordem.
          this.seen.delete(event.eventId);
          void this.fillGap(boardId);
          return;
        }
      }
      subscription.lastSeq = event.seq;
    }
    if (event.type === 'sequence.skipped') return;
    applyRealtimeEvent(this.queryClient, event, this.context);
  }

  private async fillGap(boardId: string): Promise<void> {
    if (this.replaying.has(boardId)) return;
    const subscription = this.boards.get(boardId);
    if (subscription?.lastSeq === null || subscription === undefined) return;
    this.replaying.add(boardId);
    try {
      const replay = await api<{ events: RealtimeEvent[]; resyncRequired: boolean; seq: number }>(
        `/v1/boards/${boardId}/events`,
        { query: { after: subscription.lastSeq } },
      );
      this.applyReplay(boardId, replay);
    } catch {
      void this.queryClient.invalidateQueries({ queryKey: qk.board(boardId) });
    } finally {
      this.replaying.delete(boardId);
    }
  }

  private beat(boardId: string): void {
    const subscription = this.boards.get(boardId);
    if (
      subscription?.room === null ||
      subscription === undefined ||
      this.socket?.connected !== true
    )
      return;
    this.socket.emit('presence.heartbeat', {
      room: 'board',
      id: boardId,
      state: subscription.presenceState,
    });
  }

  private beatAll(): void {
    for (const boardId of this.boards.keys()) this.beat(boardId);
    for (const itemId of this.items.keys()) this.beatItem(itemId);
  }
}
