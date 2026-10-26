import { z } from 'zod';

/**
 * Regras puras das automações (ADR 0029/0051): leitura do gatilho, avaliação de condições sobre os
 * valores do item e resolução de valores dinâmicos das ações. A execução (I/O, transação, outbox)
 * fica no worker (`apps/worker/src/processors/automations.ts`); aqui só o que pode ser validado e
 * testado sem banco — inclusive pelo construtor de automações do frontend.
 */

/** Profundidade máxima da cadeia automação → evento → automação (proteção contra loops). */
export const MAX_AUTOMATION_DEPTH = 3;

export class AutomationConfigError extends Error {
  override readonly name = 'AutomationConfigError';
}

const TriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('item_created'),
    config: z.object({ groupId: z.uuid().optional() }).default({}),
  }),
  z.object({
    type: z.literal('column_value_changed'),
    config: z.object({
      columnKey: z.string().min(1),
      /** Valores-alvo (ids de rótulo/opção/pessoa, textos, números ou booleanos). */
      to: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
      /** Nome do rótulo de status (resolvido para id pelo processador). */
      toLabel: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('button_clicked'),
    config: z.object({ columnKey: z.string().min(1) }),
  }),
  z.object({
    type: z.literal('date_arrives'),
    config: z.object({
      /** Campo nativo (`plannedEndDate`...) ou chave de coluna `date`. */
      columnKey: z.string().min(1),
      /** Dias de deslocamento: negativo = antes da data, 0 = no dia, positivo = depois. */
      offsetDays: z.number().int().min(-365).max(365).default(0),
    }),
  }),
]);
export type AutomationTriggerSpec = z.infer<typeof TriggerSchema>;
export type AutomationTriggerType = AutomationTriggerSpec['type'];

/** Gatilhos disparados por um evento de item (`item.created`/`item.updated`/`item.button_clicked`). */
export const EVENT_TRIGGER_TYPES = ['item_created', 'column_value_changed', 'button_clicked'] as const;
/** Gatilhos verificados por varredura periódica (sem evento correspondente). */
export const DATE_TRIGGER_TYPES = ['date_arrives'] as const;
export const AUTOMATION_TRIGGER_TYPES: readonly AutomationTriggerType[] = [
  ...EVENT_TRIGGER_TYPES,
  ...DATE_TRIGGER_TYPES,
];

const DynamicValueSchema = z.union([
  z
    .object({
      relative: z.literal('today'),
      offsetDays: z.number().int().min(-3650).max(3650).optional(),
    })
    .strict(),
  z.null(),
  z.record(z.string(), z.unknown()),
  z.string(),
]);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move_to_group'), config: z.object({ groupId: z.uuid() }) }),
  z.object({
    type: z.literal('set_column_value'),
    config: z.union([
      z.object({ binding: z.string().startsWith('item.'), value: DynamicValueSchema }),
      z.object({ columnKey: z.string().min(1), value: DynamicValueSchema }),
    ]),
  }),
  z.object({
    type: z.literal('notify'),
    config: z.object({
      peopleColumnKey: z.string().optional(),
      userIds: z.array(z.uuid()).max(200).optional(),
      message: z.string().min(1).max(500),
    }),
  }),
]);
export type AutomationActionSpec = z.infer<typeof ActionSchema>;
export type AutomationActionType = AutomationActionSpec['type'];
export const AUTOMATION_ACTION_TYPES: readonly AutomationActionType[] = [
  'move_to_group',
  'set_column_value',
  'notify',
];

export function parseTrigger(raw: unknown): AutomationTriggerSpec {
  const parsed = TriggerSchema.safeParse(raw);
  if (!parsed.success)
    throw new AutomationConfigError(`Gatilho inválido: ${parsed.error.issues[0]?.message ?? ''}`);
  return parsed.data;
}

export function parseActions(raw: unknown): AutomationActionSpec[] {
  const parsed = z.array(ActionSchema).min(1).max(20).safeParse(raw);
  if (!parsed.success)
    throw new AutomationConfigError(`Ações inválidas: ${parsed.error.issues[0]?.message ?? ''}`);
  return parsed.data;
}

type Scalar = string | number | boolean;

/** Valores comparáveis de uma célula (rótulo, opções, pessoas, texto, número, data, checkbox). */
export function scalarsOf(value: unknown): Scalar[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return [value];
  if (typeof value !== 'object') return [];
  const cell = value as Record<string, unknown>;
  const out: Scalar[] = [];
  for (const key of ['labelId', 'text', 'd', 'checked', 'email', 'url']) {
    const entry = cell[key];
    if (typeof entry === 'string' || typeof entry === 'boolean') out.push(entry);
  }
  if (typeof cell.n === 'string' || typeof cell.n === 'number') out.push(Number(cell.n));
  for (const key of ['optionIds', 'personIds', 'teamIds']) {
    const list = cell[key];
    if (Array.isArray(list)) list.forEach((entry) => out.push(String(entry)));
  }
  return out;
}

/** Valor de data (AAAA-MM-DD) de um campo nativo (string direta) ou de uma coluna `date` (`{d}`). */
export function dateValueOf(value: unknown): string | null {
  const [first] = scalarsOf(value);
  return typeof first === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : null;
}

/** Vazio para fins de obrigatoriedade/condições: `null`, string vazia, lista vazia, `false`. */
export function isEmptyValue(value: unknown): boolean {
  return scalarsOf(value).filter((entry) => entry !== '' && entry !== false).length === 0;
}

const ConditionSchema = z
  .object({
    columnKey: z.string().optional(),
    field: z.string().optional(),
    operator: z.enum([
      'is',
      'is_not',
      'any_of',
      'none_of',
      'contains',
      'not_contains',
      'gt',
      'gte',
      'lt',
      'lte',
      'is_empty',
      'is_not_empty',
    ]),
    value: z.unknown().optional(),
  })
  .refine((data) => data.columnKey !== undefined || data.field !== undefined, {
    message: 'Condição sem coluna.',
  });
export interface ConditionGroup {
  op: 'and' | 'or';
  conditions: (z.infer<typeof ConditionSchema> | ConditionGroup)[];
}
const GroupSchema: z.ZodType<ConditionGroup> = z.lazy(() =>
  z.object({
    op: z.enum(['and', 'or']),
    conditions: z.array(z.union([GroupSchema, ConditionSchema])).max(50),
  }),
);

function compare(left: Scalar, right: unknown): number | null {
  if (typeof left === 'number' || typeof right === 'number') {
    const a = Number(left);
    const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
  }
  if (typeof right !== 'string' || typeof left !== 'string') return null;
  return left < right ? -1 : left > right ? 1 : 0;
}

function evaluateCondition(
  condition: z.infer<typeof ConditionSchema>,
  fields: Readonly<Record<string, unknown>>,
): boolean {
  const key = condition.columnKey ?? condition.field;
  if (key === undefined) throw new AutomationConfigError('Condição sem coluna.');
  const current = fields[key];
  const scalars = scalarsOf(current);
  const targets = (Array.isArray(condition.value) ? condition.value : [condition.value]).filter(
    (entry) => entry !== undefined,
  );
  const includesAny = targets.some((target) =>
    scalars.some((scalar) => scalar === target || String(scalar) === String(target)),
  );
  switch (condition.operator) {
    case 'is':
    case 'any_of':
      return includesAny;
    case 'is_not':
    case 'none_of':
      return !includesAny;
    case 'contains':
    case 'not_contains': {
      const needle = (
        typeof condition.value === 'string' || typeof condition.value === 'number'
          ? String(condition.value)
          : ''
      ).toLocaleLowerCase('pt-BR');
      const found = scalars.some((scalar) =>
        String(scalar).toLocaleLowerCase('pt-BR').includes(needle),
      );
      return condition.operator === 'contains' ? found : !found;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return scalars.some((scalar) => {
        const result = compare(scalar, condition.value);
        if (result === null) return false;
        if (condition.operator === 'gt') return result > 0;
        if (condition.operator === 'gte') return result >= 0;
        if (condition.operator === 'lt') return result < 0;
        return result <= 0;
      });
    case 'is_empty':
      return isEmptyValue(current);
    case 'is_not_empty':
      return !isEmptyValue(current);
  }
}

function evaluateGroup(group: ConditionGroup, fields: Readonly<Record<string, unknown>>): boolean {
  const results = group.conditions.map((entry) =>
    'conditions' in entry ? evaluateGroup(entry, fields) : evaluateCondition(entry, fields),
  );
  return group.op === 'and' ? results.every(Boolean) : results.some(Boolean);
}

/** Valida a estrutura das condições sem avaliá-las (`null` = sem condições). Uso: CRUD e construtor. */
export function parseConditions(raw: unknown): ConditionGroup | null {
  if (raw === null || raw === undefined) return null;
  const parsed = GroupSchema.safeParse(raw);
  if (!parsed.success)
    throw new AutomationConfigError(
      `Condições inválidas: ${parsed.error.issues[0]?.message ?? ''}`,
    );
  return parsed.data;
}

/**
 * Avalia as condições (`null` = sempre verdadeiro). `fields` contém os valores das colunas e os
 * campos nativos do item (`name`, `groupId`, `plannedEndDate`…).
 */
export function evaluateConditions(
  raw: unknown,
  fields: Readonly<Record<string, unknown>>,
): boolean {
  const parsed = parseConditions(raw);
  return parsed === null ? true : evaluateGroup(parsed, fields);
}

export interface TriggerEvent {
  type: string;
  /** Campos alterados (para `item.updated`) com o novo valor. */
  changes: readonly { field: string; value: unknown }[];
  groupId: string | null;
  /** Chave da coluna de botão clicada (para `item.button_clicked`). */
  columnKey?: string | undefined;
}

/** O evento dispara o gatilho? `labelIds` traduz `toLabel` (nome → ids de rótulo da coluna). */
export function triggerMatches(
  trigger: AutomationTriggerSpec,
  event: TriggerEvent,
  labelIds: readonly string[] = [],
): boolean {
  if (trigger.type === 'item_created') {
    return (
      event.type === 'item.created' &&
      (trigger.config.groupId === undefined || trigger.config.groupId === event.groupId)
    );
  }
  if (trigger.type === 'button_clicked') {
    return event.type === 'item.button_clicked' && event.columnKey === trigger.config.columnKey;
  }
  if (trigger.type === 'date_arrives') return false; // verificado por varredura, não por evento.
  if (event.type !== 'item.updated') return false;
  const change = event.changes.find((entry) => entry.field === trigger.config.columnKey);
  if (change === undefined) return false;
  const targets: Scalar[] = [...(trigger.config.to ?? []), ...labelIds];
  if (trigger.config.to === undefined && trigger.config.toLabel === undefined) return true;
  const scalars = scalarsOf(change.value);
  return targets.some((target) => scalars.some((scalar) => String(scalar) === String(target)));
}

/** A data do campo (resolvida) bate com "hoje" + `offsetDays` do gatilho `date_arrives`? */
export function dateArrivesMatches(
  trigger: Extract<AutomationTriggerSpec, { type: 'date_arrives' }>,
  fieldValue: unknown,
  today: string,
): boolean {
  const date = dateValueOf(fieldValue);
  if (date === null) return false;
  return addDaysToIso(date, trigger.config.offsetDays) === today;
}

/** Soma dias a uma data `AAAA-MM-DD` (aritmética em UTC, sem fuso). */
export function addDaysToIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Data local (YYYY-MM-DD) no fuso do tenant. */
export function localDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Resolve valores dinâmicos (`{ relative: 'today' }`) para data ISO ou mantém o valor literal. */
export function resolveDynamicValue(value: unknown, now: Date, timeZone: string): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { relative?: unknown }).relative === 'today'
  ) {
    const offset = (value as { offsetDays?: number }).offsetDays ?? 0;
    const date = new Date(`${localDate(now, timeZone)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }
  return value;
}

/** Substitui `{item.name}` e `{item.<campo>}` na mensagem. */
export function renderMessage(template: string, fields: Readonly<Record<string, unknown>>): string {
  return template.replace(/\{item\.([A-Za-z0-9_]+)\}/g, (_match, key: string) => {
    const value = fields[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    const scalars = scalarsOf(value);
    return scalars.length > 0 ? scalars.join(', ') : '';
  });
}
