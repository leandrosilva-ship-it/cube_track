import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import {
  PRESENCE_HEARTBEAT_SECONDS,
  PresenceHeartbeatSchema,
  rooms,
  SubscribeRequestSchema,
  type RealtimeEvent,
} from '@cube-track/shared';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import { TokenService } from '../../core/auth/token.service.js';
import type { AuthPrincipal } from '../../core/context/request-context.js';
import { TransactionRunner } from '../../core/database/transaction-runner.js';
import { mapError } from '../../core/errors/map-error.js';
import { appMetrics } from '../../core/observability/metrics.js';
import { AccessService } from '../access/application/access.service.js';
import { BoardsService } from '../work/application/boards.service.js';
import { ItemsRepository } from '../work/infrastructure/items.repository.js';
import { FanoutService } from './fanout.service.js';
import { PresenceService } from './presence.service.js';

export interface SocketData {
  principal: AuthPrincipal;
  expiresAt: number;
  subscriptions: Map<string, { type: 'board' | 'item' | 'dashboard'; id: string }>;
  expiryTimer?: NodeJS.Timeout;
}

type Ack = (response: Record<string, unknown>) => void;

const RefreshSchema = z.object({ token: z.string().min(10) });

/**
 * Gateway WebSocket (Socket.IO). Autenticação no handshake (`auth.token`), rooms por board, item,
 * dashboard e usuário, presença com heartbeat e replay por sequência. Comandos de escrita trafegam
 * por REST (ADR 0007): qualquer outro evento do cliente é rejeitado.
 */
@WebSocketGateway({ cors: true })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly runner: TransactionRunner,
    private readonly boards: BoardsService,
    private readonly items: ItemsRepository,
    private readonly presence: PresenceService,
    private readonly fanout: FanoutService,
  ) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => {
      void this.sweepPresence();
    }, PRESENCE_HEARTBEAT_SECONDS * 1000);
    this.sweepTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer !== undefined) clearInterval(this.sweepTimer);
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const auth = socket.handshake.auth as { token?: unknown } | undefined;
      const header = socket.handshake.headers.authorization;
      const token =
        typeof auth?.token === 'string'
          ? auth.token
          : header?.startsWith('Bearer ') === true
            ? header.slice(7)
            : undefined;
      if (token === undefined) throw new Error('missing token');
      const verified = await this.tokens.verifyAccessToken(token);
      await this.access.principal(verified.principal);
      const data: SocketData = {
        principal: verified.principal,
        expiresAt: verified.expiresAt,
        subscriptions: new Map(),
      };
      socket.data = data;
      this.scheduleExpiry(socket);
      await socket.join([
        rooms.tenant(verified.principal.tenantId),
        rooms.user(verified.principal.tenantId, verified.principal.userId),
      ]);
      socket.onAny((event: string, ...args: unknown[]) => {
        if (['subscribe', 'unsubscribe', 'presence.heartbeat', 'auth.refresh'].includes(event))
          return;
        const ack = args.at(-1);
        if (typeof ack === 'function') {
          (ack as Ack)({
            ok: false,
            error: { code: 'commands_via_rest', message: 'Alterações são feitas pela API REST.' },
          });
        }
      });
      appMetrics.realtimeConnections.add(1);
      socket.emit('ready', {
        userId: verified.principal.userId,
        tenantId: verified.principal.tenantId,
      });
    } catch (error) {
      const problem = mapError(error);
      socket.emit('auth_error', {
        code: problem.status === 500 ? 'unauthenticated' : problem.code,
        message: 'Autenticação inválida.',
      });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const data = socket.data as SocketData | undefined;
    if (data?.principal === undefined) return;
    appMetrics.realtimeConnections.add(-1);
    if (data.expiryTimer !== undefined) clearTimeout(data.expiryTimer);
    for (const room of data.subscriptions.keys()) {
      if (await this.presence.leave(room, data.principal.userId, socket.id)) {
        this.server
          .to(room)
          .emit('event', this.presenceEvent(data.principal, 'presence.left', room, {}));
      }
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<Record<string, unknown>> {
    const data = socket.data as SocketData;
    try {
      const request = SubscribeRequestSchema.parse(body);
      const user = data.principal;
      let room: string;
      if (request.room === 'board') {
        if (!(await this.access.can(user, 'board.read', { type: 'board', id: request.id })))
          return this.denied();
        room = rooms.board(user.tenantId, request.id);
      } else if (request.room === 'item') {
        const item = await this.runner.run(
          { tenantId: user.tenantId, userId: user.userId },
          () => this.items.findById(this.runner.tx, request.id),
          { readOnly: true },
        );
        if (item === null || !(await this.access.can(user, 'item.read', { type: 'item', item })))
          return this.denied();
        room = rooms.item(user.tenantId, request.id);
      } else {
        if (!(await this.access.can(user, 'dashboard.read', { type: 'dashboard', id: request.id })))
          return this.denied();
        room = rooms.dashboard(user.tenantId, request.id);
      }
      await socket.join(room);
      data.subscriptions.set(room, { type: request.room, id: request.id });
      const presence = await this.presence.list(room);
      let replay: { events: RealtimeEvent[]; resyncRequired: boolean; seq: number } | undefined;
      if (request.room === 'board' && request.lastSeq !== undefined) {
        const lastSeq = request.lastSeq;
        replay = await this.runner.run(
          { tenantId: user.tenantId, userId: user.userId },
          () => this.boards.replay(user, request.id, lastSeq),
          { readOnly: true },
        );
      }
      return { ok: true, room, presence, ...(replay === undefined ? {} : { replay }) };
    } catch (error) {
      const problem = mapError(error);
      return { ok: false, error: { code: problem.code, message: problem.detail } };
    }
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<Record<string, unknown>> {
    const data = socket.data as SocketData;
    const parsed = SubscribeRequestSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: { code: 'validation_failed' } };
    const user = data.principal;
    const room =
      parsed.data.room === 'board'
        ? rooms.board(user.tenantId, parsed.data.id)
        : parsed.data.room === 'item'
          ? rooms.item(user.tenantId, parsed.data.id)
          : rooms.dashboard(user.tenantId, parsed.data.id);
    await socket.leave(room);
    data.subscriptions.delete(room);
    if (await this.presence.leave(room, user.userId, socket.id)) {
      this.server.to(room).emit('event', this.presenceEvent(user, 'presence.left', room, {}));
    }
    return { ok: true };
  }

  @SubscribeMessage('presence.heartbeat')
  async heartbeat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<Record<string, unknown>> {
    const data = socket.data as SocketData;
    const parsed = PresenceHeartbeatSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: { code: 'validation_failed' } };
    const user = data.principal;
    const room =
      parsed.data.room === 'board'
        ? rooms.board(user.tenantId, parsed.data.id)
        : parsed.data.room === 'item'
          ? rooms.item(user.tenantId, parsed.data.id)
          : rooms.dashboard(user.tenantId, parsed.data.id);
    if (!data.subscriptions.has(room)) return { ok: false, error: { code: 'not_subscribed' } };
    const result = await this.presence.heartbeat(room, user.userId, socket.id, parsed.data.state);
    if (result !== 'unchanged') {
      const type = result === 'joined' ? 'presence.joined' : 'presence.updated';
      this.server.to(room).emit('event', this.presenceEvent(user, type, room, parsed.data.state));
    }
    return { ok: true };
  }

  /** Renova o token de um socket aberto (o cliente envia o novo access token após o refresh). */
  @SubscribeMessage('auth.refresh')
  async refresh(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<Record<string, unknown>> {
    const data = socket.data as SocketData;
    try {
      const { token } = RefreshSchema.parse(body);
      const verified = await this.tokens.verifyAccessToken(token);
      if (
        verified.principal.userId !== data.principal.userId ||
        verified.principal.tenantId !== data.principal.tenantId
      ) {
        return { ok: false, error: { code: 'token_mismatch' } };
      }
      data.principal = verified.principal;
      data.expiresAt = verified.expiresAt;
      this.scheduleExpiry(socket);
      return { ok: true, expiresAt: verified.expiresAt };
    } catch (error) {
      return { ok: false, error: { code: mapError(error).code } };
    }
  }

  private denied(): Record<string, unknown> {
    return { ok: false, error: { code: 'forbidden', message: 'Sem acesso a este recurso.' } };
  }

  private scheduleExpiry(socket: Socket): void {
    const data = socket.data as SocketData;
    if (data.expiryTimer !== undefined) clearTimeout(data.expiryTimer);
    data.expiryTimer = setTimeout(
      () => {
        socket.emit('auth_error', {
          code: 'token_expired',
          message: 'Sessão expirada; renove o token.',
        });
        socket.disconnect(true);
      },
      Math.max(0, data.expiresAt - Date.now()),
    );
    data.expiryTimer.unref();
  }

  private presenceEvent(
    user: AuthPrincipal,
    type: 'presence.joined' | 'presence.updated' | 'presence.left',
    room: string,
    state: Record<string, unknown>,
  ) {
    return this.fanout.ephemeralEvent(
      user.tenantId,
      user.userId,
      type,
      type === 'presence.left'
        ? { room, userId: user.userId }
        : { room, userId: user.userId, state },
    );
  }

  private async sweepPresence(): Promise<void> {
    try {
      for (const [room, userId] of await this.presence.sweep()) {
        const tenantId = room.split(':')[1] ?? '';
        this.server
          .to(room)
          .emit(
            'event',
            this.fanout.ephemeralEvent(tenantId, userId, 'presence.left', { room, userId }),
          );
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Falha na varredura de presença');
    }
  }
}
