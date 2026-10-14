import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';

import { requireContext } from '../context/request-context.js';
import { TransactionRunner } from '../database/transaction-runner.js';
import { httpPair, isGraphql } from '../http/execution.js';
import { AUDITED_METADATA, READ_ONLY_METADATA, type AuditedSpec } from './audited.js';

/**
 * Abre a unidade de trabalho de cada requisição autenticada:
 * - leitura (GET e GraphQL): transação read-only com contexto do tenant (RLS);
 * - mutação com `@Audited`: transação de escrita + auditoria (quem, o quê, antes/depois, IP,
 *   user agent) + log de atividade + outbox, publicando eventos realtime após o commit.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly runner: TransactionRunner,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const pair = httpPair(context);
    const store = requireContext();
    if (pair === null || store.principal === null) return next.handle();
    const audited = this.reflector.get<AuditedSpec | undefined>(
      AUDITED_METADATA,
      context.getHandler(),
    );
    if (audited?.transactional === false) return next.handle();
    const readOnly =
      isGraphql(context) ||
      pair.request.method === 'GET' ||
      pair.request.method === 'HEAD' ||
      this.reflector.get<boolean | undefined>(READ_ONLY_METADATA, context.getHandler()) === true;
    const principal = store.principal;
    return from(
      this.runner.run(
        { tenantId: principal.tenantId, userId: principal.userId },
        () => lastValueFrom(next.handle(), { defaultValue: undefined }),
        readOnly
          ? { readOnly: true }
          : {
              fallbackAudit: {
                action:
                  audited?.action ?? `${pair.request.method.toLowerCase()} ${pair.request.path}`,
                entityType: audited?.entityType ?? 'request',
              },
            },
      ),
    );
  }
}
