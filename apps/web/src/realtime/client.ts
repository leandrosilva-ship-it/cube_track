import { PRESENCE_HEARTBEAT_SECONDS, type RealtimeEvent } from '@cube-track/shared';
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

export type SocketFactory = (token: string) => Socket;

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

/**
 * Cliente realtime: uma conexão Socket.IO por aba, assinaturas de board com contagem de referências,
 * aplicação ordenada por `seq` (lacuna → replay; replay impossível → resync), deduplicação por
 * `eventId`, presença com heartbeat e reconexão com backoff exponencial + jitter (ADR 0033).
 */
export class RealtimeClient {
  private socket: Socket | null = null;
  private readonly boards = new Map<string, BoardSubscription>();
  private readonly seen = new Set<string>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly replaying = new Set<string>();

  constructor(
    private readonly queryClient: QueryClient,
    private readonly createSocket: SocketFactory,
    private readonly context: ApplyContext,
  ) {}

  start(token: string): void {
    if (this.socket !== null) return;
    realtimeStore.setState({ status: 'connecting' });
    const socket = this.createSocket(token);
    this.socket = socket;
    socket.on('ready', () => {
      realtimeStore.setState({ status: 'online' });
      for (const boardId of this.boards.keys()) void this.subscribe(boardId);
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
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.boards.clear();
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
  }
}
