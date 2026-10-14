import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  newId,
  REALTIME_CHANNEL,
  rooms,
  type RealtimeEvent,
  type RealtimeEventType,
  type RealtimeTransportMessage,
} from '@cube-track/shared';
import type { Redis } from 'ioredis';
import type { RemoteSocket, Server } from 'socket.io';

import { REDIS_SUBSCRIBER } from '../../core/redis/redis.module.js';
import { appMetrics } from '../../core/observability/metrics.js';
import { AccessService } from '../access/application/access.service.js';
import { redactEventFor } from '../work/domain/event-redaction.js';
import { ItemsService } from '../work/application/items.service.js';
import type { SocketData } from './realtime.gateway.js';

const DEDUPE_SIZE = 20_000;

type BoardSocket = RemoteSocket<{ event: (event: RealtimeEvent) => void }, SocketData>;

/**
 * Fan-out dos eventos de domínio para os sockets LOCAIS deste nó (cada nó assina o canal Redis).
 * Eventos de board/item são redigidos por destinatário: escopo de itens do convidado e colunas
 * ocultas (mesma regra de REST/GraphQL). Deduplica por `eventId` (fast path + relay do outbox).
 */
@Injectable()
export class FanoutService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FanoutService.name);
  private server: Server | undefined;
  private readonly seen = new Set<string>();

  constructor(
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    private readonly access: AccessService,
    private readonly items: ItemsService,
  ) {}

  attach(server: Server): void {
    this.server = server;
  }

  async onApplicationBootstrap(): Promise<void> {
    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== REALTIME_CHANNEL) return;
      void this.dispatch(raw).catch((error: unknown) => {
        this.logger.error({ err: error }, 'Falha no fan-out realtime');
      });
    });
    await this.subscriber.subscribe(REALTIME_CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber.unsubscribe(REALTIME_CHANNEL).catch(() => undefined);
  }

  /** Evento efêmero (presença) — não passa pelo outbox. */
  ephemeralEvent<T extends RealtimeEventType>(
    tenantId: string,
    userId: string,
    type: T,
    payload: RealtimeEvent<T>['payload'],
  ): RealtimeEvent<T> {
    return {
      eventId: newId(),
      type,
      tenantId,
      scope: { boardId: null, itemId: null, userId: null, dashboardId: null },
      seq: null,
      actor: { userId, kind: 'user' },
      clientMutationId: null,
      occurredAt: new Date().toISOString(),
      payload,
      schemaVersion: 1,
    };
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

  async dispatch(raw: string): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    const message = JSON.parse(raw) as RealtimeTransportMessage;
    const { event } = message;
    if (!this.remember(event.eventId)) return;
    const { tenantId, scope } = event;

    if (scope.boardId !== null) {
      const targets = new Map<string, BoardSocket>();
      const roomNames = [
        rooms.board(tenantId, scope.boardId),
        ...(scope.itemId === null ? [] : [rooms.item(tenantId, scope.itemId)]),
      ];
      for (const room of roomNames) {
        for (const socket of (await server.local
          .in(room)
          .fetchSockets()) as unknown as BoardSocket[])
          targets.set(socket.id, socket);
      }
      await Promise.all(
        [...targets.values()].map((socket) => this.deliverBoardEvent(socket, message)),
      );
      return;
    }
    if (scope.userId !== null) {
      const room = rooms.user(tenantId, scope.userId);
      if (event.type === 'session.revoked') {
        const { sessionId } = event.payload as { sessionId: string };
        for (const socket of await server.local.in(room).fetchSockets()) {
          if ((socket.data as SocketData).principal.sessionId === sessionId) {
            socket.emit('event', event);
            socket.disconnect(true);
          }
        }
        return;
      }
      server.local.to(room).emit('event', event);
      this.observe(event, 1);
      return;
    }
    if (scope.dashboardId !== null) {
      server.local.to(rooms.dashboard(tenantId, scope.dashboardId)).emit('event', event);
      return;
    }
    server.local.to(rooms.tenant(tenantId)).emit('event', event);
  }

  private async deliverBoardEvent(
    socket: BoardSocket,
    message: RealtimeTransportMessage,
  ): Promise<void> {
    const data = socket.data;
    const boardId = message.event.scope.boardId;
    if (boardId === null) return;
    try {
      const principal = await this.access.principal(data.principal);
      const board = await this.access.board(data.principal, boardId);
      const visibility = await this.items.visibility(data.principal, boardId);
      socket.emit('event', redactEventFor(message, principal, board, visibility));
      this.observe(message.event, 1);
    } catch (error) {
      this.logger.warn(
        { err: error, socketId: socket.id },
        'Evento não entregue (permissão/estado do usuário)',
      );
    }
  }

  private observe(event: RealtimeEvent, count: number): void {
    appMetrics.realtimeDelivered.add(count, { type: event.type });
    appMetrics.realtimeLatency.record(Date.now() - new Date(event.occurredAt).getTime(), {
      type: event.type,
    });
  }
}
