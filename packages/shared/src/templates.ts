import { z } from 'zod';

import { parseActions, parseTrigger, type AutomationActionSpec, type AutomationTriggerSpec } from './automations.js';
import { NATIVE_FORM_FIELD_TYPES, type NativeFormFieldType } from './forms.js';
import { WIDGET_TYPES, WidgetLayoutSchema, parseWidgetConfig, type WidgetConfig, type WidgetLayout, type WidgetType } from './widgets.js';

/**
 * Templates (Prompt 15, ADR 0056): a tabela `templates` (reservada desde o Prompt 2, `tenant_id`
 * nulo = template global da plataforma) ganha conteúdo real aqui — cada `kind` tem um `payload`
 * validado nesse arquivo, reaproveitando os motores já testados de cada módulo (gatilho/ação das
 * automações, config de widget dos dashboards, tipos nativos de formulário) em vez de inventar uma
 * segunda validação. `item` é um `kind` reservado no enum do banco desde sempre mas **não** é
 * implementado nesta entrega — o prompt não pede templates de item, e nenhuma UI o expõe; fica como
 * limitação documentada, não escondida.
 */

export const TEMPLATE_KINDS = ['board', 'workspace', 'dashboard', 'automation', 'form'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export function isTemplateKind(value: string): value is TemplateKind {
  return (TEMPLATE_KINDS as readonly string[]).includes(value);
}

export class TemplateConfigError extends Error {
  override readonly name = 'TemplateConfigError';
}

// ----------------------------------------------------------------------------------- board ---

const TemplateLabelSchema = z
  .object({
    label: z.string().min(1).max(60),
    color: z.string().min(1).max(20),
    category: z.enum(['not_started', 'in_progress', 'stuck', 'done']),
  })
  .strict();

const TemplateColumnSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z][a-z0-9_]*$/, 'A chave da coluna deve ser snake_case iniciando por letra.'),
    type: z.string().min(1).max(40),
    title: z.string().min(1).max(120),
    width: z.number().int().min(60).max(600).optional(),
    binding: z.string().min(1).max(60).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    description: z.string().max(500).optional(),
    labels: z.array(TemplateLabelSchema).max(30).optional(),
    options: z.array(z.object({ label: z.string().min(1).max(80), color: z.string().min(1).max(20) }).strict()).max(100).optional(),
    isRequired: z.boolean().optional(),
    requiredWhenLabel: z.object({ columnKey: z.string().min(1), labelIndex: z.number().int().min(0) }).strict().optional(),
  })
  .strict();

export const BoardTemplatePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    icon: z.string().trim().min(1).max(60).default('layout-grid'),
    groups: z
      .array(z.object({ name: z.string().trim().min(1).max(120), color: z.string().min(1).max(20) }).strict())
      .min(1)
      .max(50),
    columns: z.array(TemplateColumnSchema).min(1).max(120),
    statusColumnKey: z.string().min(1).max(60),
    viewName: z.string().trim().min(1).max(120).default('Tabela principal'),
    /** Itens incluídos no snapshot ("salvar board como template" com dados) — nunca na galeria pública. */
    items: z
      .array(
        z
          .object({
            groupName: z.string().min(1).max(120),
            name: z.string().min(1).max(300),
            values: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
      )
      .max(5_000)
      .optional(),
  })
  .strict();
export type BoardTemplatePayload = z.infer<typeof BoardTemplatePayloadSchema>;

// ------------------------------------------------------------------------------- workspace ---

export const WorkspaceTemplatePayloadSchema = z
  .object({
    boards: z.array(z.object({ name: z.string().trim().min(1).max(120), blueprint: BoardTemplatePayloadSchema }).strict()).min(1).max(30),
  })
  .strict();
export type WorkspaceTemplatePayload = z.infer<typeof WorkspaceTemplatePayloadSchema>;

// ------------------------------------------------------------------------------- automation ---

const RawAutomationTemplatePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().default(null),
    trigger: z.unknown(),
    actions: z.array(z.unknown()).min(1).max(10),
  })
  .strict();

export interface AutomationTemplatePayload {
  name: string;
  description: string | null;
  trigger: AutomationTriggerSpec;
  actions: AutomationActionSpec[];
}

/** Valida `trigger`/`actions` reaproveitando `parseTrigger`/`parseActions` (ADR 0051) — nunca uma
 * segunda implementação do vocabulário de gatilho/ação. */
export function parseAutomationTemplatePayload(raw: unknown): AutomationTemplatePayload {
  const parsed = RawAutomationTemplatePayloadSchema.parse(raw);
  return {
    name: parsed.name,
    description: parsed.description,
    trigger: parseTrigger(parsed.trigger),
    actions: parseActions(parsed.actions),
  };
}

// -------------------------------------------------------------------------------- dashboard ---

const RawDashboardWidgetEntrySchema = z
  .object({
    type: z.enum(WIDGET_TYPES),
    title: z.string().trim().min(1).max(120),
    config: z.unknown(),
    layout: z.unknown(),
  })
  .strict();

export interface DashboardTemplateWidgetEntry {
  type: WidgetType;
  title: string;
  config: WidgetConfig;
  layout: WidgetLayout;
}

export interface DashboardTemplatePayload {
  name: string;
  widgets: DashboardTemplateWidgetEntry[];
}

/** Valida cada widget reaproveitando `parseWidgetConfig`/`WidgetLayoutSchema` (packages/shared/src/widgets.ts). */
export function parseDashboardTemplatePayload(raw: unknown): DashboardTemplatePayload {
  const parsed = z
    .object({ name: z.string().trim().min(1).max(120), widgets: z.array(RawDashboardWidgetEntrySchema).max(40) })
    .strict()
    .parse(raw);
  return {
    name: parsed.name,
    widgets: parsed.widgets.map((entry) => ({
      type: entry.type,
      title: entry.title,
      config: parseWidgetConfig(entry.type, entry.config),
      layout: WidgetLayoutSchema.parse(entry.layout),
    })),
  };
}

// -------------------------------------------------------------------------------------- form ---

const FormTemplateFieldEntrySchema = z
  .object({
    fieldType: z.enum(NATIVE_FORM_FIELD_TYPES),
    label: z.string().trim().min(1).max(160),
    isRequired: z.boolean().default(false),
  })
  .strict();
export type FormTemplateFieldEntry = z.infer<typeof FormTemplateFieldEntrySchema> & {
  fieldType: NativeFormFieldType;
};

export const FormTemplatePayloadSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).default(''),
    fields: z.array(FormTemplateFieldEntrySchema).min(1).max(40),
  })
  .strict();
export type FormTemplatePayload = z.infer<typeof FormTemplatePayloadSchema>;

// --------------------------------------------------------------------------------- dispatch ---

export type TemplatePayloadOf<K extends TemplateKind> = K extends 'board'
  ? BoardTemplatePayload
  : K extends 'workspace'
    ? WorkspaceTemplatePayload
    : K extends 'automation'
      ? AutomationTemplatePayload
      : K extends 'dashboard'
        ? DashboardTemplatePayload
        : FormTemplatePayload;

/** Ponto único de validação de `templates.payload` por `kind` — nunca confiar no jsonb sem checar. */
export function parseTemplatePayload<K extends TemplateKind>(kind: K, raw: unknown): TemplatePayloadOf<K> {
  try {
    switch (kind) {
      case 'board':
        return BoardTemplatePayloadSchema.parse(raw) as TemplatePayloadOf<K>;
      case 'workspace':
        return WorkspaceTemplatePayloadSchema.parse(raw) as TemplatePayloadOf<K>;
      case 'automation':
        return parseAutomationTemplatePayload(raw) as TemplatePayloadOf<K>;
      case 'dashboard':
        return parseDashboardTemplatePayload(raw) as TemplatePayloadOf<K>;
      case 'form':
        return FormTemplatePayloadSchema.parse(raw) as TemplatePayloadOf<K>;
      default:
        throw new TemplateConfigError(`Tipo de template desconhecido: ${String(kind)}`);
    }
  } catch (error) {
    if (error instanceof TemplateConfigError) throw error;
    throw new TemplateConfigError(`Conteúdo de template inválido para "${kind}": ${(error as Error).message}`);
  }
}
