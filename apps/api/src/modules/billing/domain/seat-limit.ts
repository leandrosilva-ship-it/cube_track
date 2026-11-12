import { isWithinSeatLimit, PLAN_CATALOG, type PlanTier } from '@cube-track/shared';

import { ConflictError } from '../../../core/errors/problems.js';

/**
 * Guarda de limite de vagas do plano (ADR 0059): mesma convenção de `assertModuleEnabled`
 * (`core/modules/assert-module-enabled.ts`) — função pura, sem Nest, sem Drizzle, que lança um erro
 * de domínio tipado e mapeado para RFC 7807. A contagem de vagas em uso (`currentSeats`) é
 * responsabilidade do chamador (consulta por `COUNT`, nunca um contador em cache/coluna — ver
 * `SeatLimitService`).
 */
export function assertSeatLimit(plan: PlanTier, currentSeats: number, additional = 1): void {
  if (isWithinSeatLimit(plan, currentSeats, additional)) return;
  const definition = PLAN_CATALOG[plan];
  throw new ConflictError(
    `O plano ${definition.label} permite no máximo ${String(definition.limits.maxSeats)} vaga(s) (membros ativos + convites pendentes). Faça upgrade do plano ou revogue um convite/membro para continuar.`,
    'seat_limit_exceeded',
    { plan, maxSeats: definition.limits.maxSeats, currentSeats },
  );
}
