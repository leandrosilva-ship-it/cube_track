import { Global, Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { TransactionInterceptor } from './audit/transaction.interceptor.js';
import { AuthGuard } from './auth/auth.guard.js';
import { TokenService } from './auth/token.service.js';
import { ConfigModule } from './config/config.module.js';
import { RequestContextMiddleware } from './context/request-context.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { ProblemFilter } from './errors/problem.filter.js';
import { DomainEvents } from './events/domain-events.js';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor.js';
import { QueuesModule } from './queues/queues.module.js';
import { RateLimitGuard } from './rate-limit/rate-limit.js';
import { RedisModule } from './redis/redis.module.js';
import { TenancyMiddleware } from './tenancy/tenancy.middleware.js';
import { TenantResolver } from './tenancy/tenant-resolver.service.js';

/**
 * Infraestrutura transversal. Ordem do pipeline de uma requisição:
 * contexto (correlation id) → tenant (subdomínio/header) → AuthGuard → RateLimitGuard →
 * IdempotencyInterceptor → TransactionInterceptor (RLS + auditoria + outbox) → handler.
 */
@Global()
@Module({
  imports: [ConfigModule, RedisModule, DatabaseModule, QueuesModule],
  providers: [
    TokenService,
    TenantResolver,
    DomainEvents,
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
  ],
  exports: [
    ConfigModule,
    RedisModule,
    DatabaseModule,
    QueuesModule,
    TokenService,
    TenantResolver,
    DomainEvents,
  ],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, TenancyMiddleware).forRoutes('{*path}');
  }
}
