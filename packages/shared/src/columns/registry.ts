import { z } from 'zod';

import {
  AUTO_ID_RESET_PERIODS,
  DEFAULT_AUTO_ID_MASK,
  isValidDisplayIdMask,
} from '../display-id.js';

/**
 * Registro de tipos de coluna (ADR 0005).
 *
 * Cada tipo define:
 * - `value`: schema Zod do valor armazenado em `items.values[columnKey]`;
 * - `settings`: schema Zod de `column_definitions.settings`;
 * - `projection`: como o valor é projetado em `item_field_index` para filtro por faixa/ordenação
 *   (null = sem projeção; filtros usam o índice GIN de `items.values`);
 * - `storage`: `values` (JSONB do item), `relation` (tabela própria) ou `system` (campo nativo).
 *
 * A projeção SQL correspondente está em `app.project_item_values` (migração `0002_rls_and_triggers`).
 */

const uuid = z.uuid();
const isoDate = z.iso.date();
const decimal = z.string().regex(/^-?\d{1,14}(\.\d{1,4})?$/, 'decimal inválido');

export const PROJECTION_KINDS = [
  'num',
  'date',
  'timeline',
  'text',
  'bool',
  'auto_id',
  'computed',
] as const;
export type ProjectionKind = (typeof PROJECTION_KINDS)[number];

export const COLUMN_STORAGES = ['values', 'relation', 'system'] as const;
export type ColumnStorage = (typeof COLUMN_STORAGES)[number];

const labelSettings = z.object({ defaultLabelId: uuid.optional() }).strict();
const noSettings = z.object({}).strict();

interface ColumnTypeSpec {
  value: z.ZodType;
  settings: z.ZodType;
  projection: ProjectionKind | null;
  storage: ColumnStorage;
}

function spec(
  value: z.ZodType,
  settings: z.ZodType,
  projection: ProjectionKind | null,
  storage: ColumnStorage = 'values',
): ColumnTypeSpec {
  return { value, settings, projection, storage };
}

const computedValue = z
  .object({
    n: decimal.optional(),
    d: isoDate.optional(),
    text: z.string().max(10_000).optional(),
    computedAt: z.iso.datetime(),
  })
  .strict();

export const COLUMN_TYPE_SPECS = {
  text: spec(
    z.object({ text: z.string().max(2_000) }).strict(),
    z.object({ maxLength: z.number().int().positive().max(2_000).optional() }).strict(),
    'text',
  ),
  long_text: spec(z.object({ text: z.string().max(100_000) }).strict(), noSettings, 'text'),
  number: spec(
    z.object({ n: decimal }).strict(),
    z
      .object({
        unit: z.string().max(16).optional(),
        unitPosition: z.enum(['prefix', 'suffix']).optional(),
        decimals: z.number().int().min(0).max(4).optional(),
        aggregate: z.enum(['sum', 'avg', 'min', 'max', 'count', 'none']).optional(),
      })
      .strict(),
    'num',
  ),
  status: spec(z.object({ labelId: uuid }).strict(), labelSettings, 'text'),
  dropdown: spec(
    z.object({ optionIds: z.array(uuid).max(100) }).strict(),
    z.object({ multiple: z.boolean().optional() }).strict(),
    null,
  ),
  people: spec(
    z.object({ personIds: z.array(uuid).max(200), teamIds: z.array(uuid).max(50) }).strict(),
    z.object({ maxPeople: z.number().int().positive().optional() }).strict(),
    null,
  ),
  date: spec(
    z
      .object({
        d: isoDate,
        time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .optional(),
      })
      .strict(),
    z.object({ includeTime: z.boolean().optional() }).strict(),
    'date',
  ),
  timeline: spec(z.object({ from: isoDate, to: isoDate }).strict(), noSettings, 'timeline'),
  week: spec(z.object({ from: isoDate, to: isoDate }).strict(), noSettings, 'timeline'),
  checkbox: spec(z.object({ checked: z.boolean() }).strict(), noSettings, 'bool'),
  rating: spec(
    z.object({ n: decimal }).strict(),
    z.object({ max: z.number().int().min(1).max(10).optional() }).strict(),
    'num',
  ),
  link: spec(
    z.object({ url: z.url(), text: z.string().max(500).optional() }).strict(),
    noSettings,
    'text',
  ),
  email: spec(
    z.object({ email: z.email(), text: z.string().max(500).optional() }).strict(),
    noSettings,
    'text',
  ),
  phone: spec(
    z
      .object({
        phone: z.string().regex(/^\+?[\d\s()-]{6,20}$/),
        country: z.string().length(2).optional(),
      })
      .strict(),
    noSettings,
    'text',
  ),
  tags: spec(
    z.object({ tags: z.array(z.string().min(1).max(60)).max(50) }).strict(),
    noSettings,
    null,
  ),
  file: spec(z.object({ attachmentIds: z.array(uuid).max(100) }).strict(), noSettings, null),
  auto_id: spec(
    z.object({ text: z.string().max(80), seq: z.number().int().positive() }).strict(),
    z
      .object({
        mask: z
          .string()
          .refine(isValidDisplayIdMask, 'máscara precisa de exatamente um {SEQ}')
          .default(DEFAULT_AUTO_ID_MASK),
        resetPeriod: z.enum(AUTO_ID_RESET_PERIODS).default('never'),
        applyToSubitems: z.boolean().default(false),
      })
      .strict(),
    'auto_id',
  ),
  board_relation: spec(
    z.object({ itemIds: z.array(uuid).max(500) }).strict(),
    z.object({ boardIds: z.array(uuid).min(1), allowMultiple: z.boolean().optional() }).strict(),
    null,
  ),
  mirror: spec(
    computedValue,
    z
      .object({
        relationColumnKey: z.string(),
        targetColumnKey: z.string(),
        aggregate: z.string().optional(),
      })
      .strict(),
    'computed',
  ),
  formula: spec(
    computedValue,
    z.object({ expression: z.string().min(1).max(4_000) }).strict(),
    'computed',
  ),
  progress: spec(
    computedValue,
    z.object({ sourceColumnKeys: z.array(z.string()).optional() }).strict(),
    'computed',
  ),
  dependency: spec(z.object({}).strict(), noSettings, null, 'relation'),
  time_tracking: spec(
    z.object({ n: decimal, runningSince: z.iso.datetime().optional() }).strict(),
    noSettings,
    'num',
  ),
  location: spec(
    z
      .object({
        address: z.string().max(500),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .strict(),
    noSettings,
    null,
  ),
  country: spec(z.object({ code: z.string().length(2) }).strict(), noSettings, 'text'),
  color: spec(
    z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict(),
    noSettings,
    'text',
  ),
  hour: spec(z.object({ time: z.string().regex(/^\d{2}:\d{2}$/) }).strict(), noSettings, 'text'),
  vote: spec(z.object({ userIds: z.array(uuid).max(10_000) }).strict(), noSettings, null),
  button: spec(
    z.object({}).strict(),
    z.object({ label: z.string().max(40), automationId: uuid.optional() }).strict(),
    null,
    'system',
  ),
  creation_log: spec(z.object({}).strict(), noSettings, null, 'system'),
  last_updated: spec(z.object({}).strict(), noSettings, null, 'system'),
  item_id: spec(z.object({}).strict(), noSettings, null, 'system'),
} as const satisfies Record<string, ColumnTypeSpec>;

export type ColumnType = keyof typeof COLUMN_TYPE_SPECS;
export const COLUMN_TYPES = Object.keys(COLUMN_TYPE_SPECS) as ColumnType[];

export function isColumnType(value: string): value is ColumnType {
  return Object.hasOwn(COLUMN_TYPE_SPECS, value);
}

/** Valida e normaliza o valor de uma coluna. Lança `ZodError` se inválido. */
export function parseColumnValue(type: ColumnType, value: unknown): Record<string, unknown> {
  return COLUMN_TYPE_SPECS[type].value.parse(value) as Record<string, unknown>;
}

/** Valida e normaliza as configurações de uma coluna (aplica defaults). */
export function parseColumnSettings(type: ColumnType, settings: unknown): Record<string, unknown> {
  return COLUMN_TYPE_SPECS[type].settings.parse(settings) as Record<string, unknown>;
}

/**
 * Colunas vinculadas (bound columns): a fonte da verdade é um campo nativo do item ou de um módulo,
 * não o JSONB `values`. O formato é `<entidade>.<campo>`.
 */
export const COLUMN_BINDINGS = [
  'item.planned_start_date',
  'item.planned_end_date',
  'item.replanned_start_date',
  'item.replanned_end_date',
  'item.actual_start_date',
  'item.actual_end_date',
  'item.progress',
  'service_order.number',
  'service_order.sei_process',
  'service_order.requested_at',
  'service_order.issued_at',
  'service_order.total_ust',
  'service_order.catalog_codes',
  'service_order.billed_at',
] as const;
export type ColumnBinding = (typeof COLUMN_BINDINGS)[number];
