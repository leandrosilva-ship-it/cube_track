import { z } from 'zod';

/**
 * Relato de saúde do projeto (ADR 0050): série histórica, sempre manual (quem relata decide as cores),
 * sem motor de EVM automático nesta entrega. `spi`/`cpi` são informados por quem relata, quando
 * disponíveis, não calculados a partir do cronograma.
 */

export const HEALTH_STATUSES = ['green', 'yellow', 'red', 'grey'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const PROJECT_HEALTH_DIMENSIONS = [
  'overall',
  'schedule',
  'cost',
  'scope',
  'quality',
  'risk',
] as const;
export type ProjectHealthDimension = (typeof PROJECT_HEALTH_DIMENSIONS)[number];

export const CreateProjectHealthSchema = z
  .object({
    overall: z.enum(HEALTH_STATUSES),
    schedule: z.enum(HEALTH_STATUSES).default('grey'),
    cost: z.enum(HEALTH_STATUSES).default('grey'),
    scope: z.enum(HEALTH_STATUSES).default('grey'),
    quality: z.enum(HEALTH_STATUSES).default('grey'),
    risk: z.enum(HEALTH_STATUSES).default('grey'),
    percentComplete: z.number().min(0).max(100).optional(),
    spi: z.number().min(0).max(99).optional(),
    cpi: z.number().min(0).max(99).optional(),
    summary: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();
export type CreateProjectHealthInput = z.infer<typeof CreateProjectHealthSchema>;
