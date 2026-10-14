import { createHash } from 'node:crypto';

import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { catchError, from, mergeMap, of, throwError, type Observable } from 'rxjs';

import { requireContext } from '../context/request-context.js';
import { ConflictError, UnprocessableError, ValidationError } from '../errors/problems.js';
import { REDIS } from '../redis/redis.module.js';

const TTL_SECONDS = 24 * 3600;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

interface StoredResponse {
  state: 'processing' | 'done';
  hash: string;
  status?: number;
  body?: unknown;
}

/**
 * Idempotência de POST via header `Idempotency-Key` (24 h): a primeira execução grava a resposta;
 * repetições com o mesmo corpo recebem a mesma resposta (`Idempotent-Replayed: true`), com corpo
 * diferente recebem 422 e, durante o processamento, 409.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const header = request.headers['idempotency-key'];
    if (request.method !== 'POST' || typeof header !== 'string') return next.handle();
    if (!KEY_PATTERN.test(header)) {
      throw new ValidationError([
        { path: 'headers.idempotency-key', message: 'Use 8–128 caracteres [A-Za-z0-9_-].' },
      ]);
    }
    const declared = Reflect.getMetadata(HTTP_CODE_METADATA, context.getHandler()) as
      | number
      | undefined;
    const successStatus = declared ?? 201;
    const store = requireContext();
    const owner =
      store.principal === null
        ? `ip:${store.ip ?? ''}`
        : `${store.principal.tenantId}:${store.principal.userId}`;
    const key = `idem:${owner}:${request.path}:${header}`;
    const hash = createHash('sha256')
      .update(JSON.stringify(request.body ?? null))
      .digest('hex');

    return from(
      this.redis.set(
        key,
        JSON.stringify({ state: 'processing', hash } satisfies StoredResponse),
        'EX',
        TTL_SECONDS,
        'NX',
      ),
    ).pipe(
      mergeMap((acquired) => {
        if (acquired === 'OK') {
          return next.handle().pipe(
            mergeMap(async (body: unknown) => {
              const stored: StoredResponse = { state: 'done', hash, status: successStatus, body };
              await this.redis.set(key, JSON.stringify(stored), 'EX', TTL_SECONDS);
              return body;
            }),
            catchError((error: unknown) =>
              from(this.redis.del(key)).pipe(mergeMap(() => throwError(() => error))),
            ),
          );
        }
        return from(this.redis.get(key)).pipe(
          mergeMap((raw) => {
            const stored = raw === null ? null : (JSON.parse(raw) as StoredResponse);
            if (stored === null)
              throw new ConflictError(
                'Requisição idempotente expirou durante o processamento.',
                'idempotency_retry',
              );
            if (stored.hash !== hash) {
              throw new UnprocessableError(
                'A Idempotency-Key já foi usada com outro corpo.',
                'idempotency_key_reuse',
              );
            }
            if (stored.state === 'processing') {
              throw new ConflictError(
                'Uma requisição com esta Idempotency-Key ainda está em processamento.',
                'idempotency_in_progress',
              );
            }
            response.status(stored.status ?? 200);
            response.setHeader('Idempotent-Replayed', 'true');
            return of(stored.body);
          }),
        );
      }),
    );
  }
}
