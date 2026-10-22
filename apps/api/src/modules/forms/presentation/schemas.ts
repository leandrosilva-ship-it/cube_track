import { FilterGroupSchema } from '@cube-track/shared';
import { z } from 'zod';

export const BoardParams = z.object({ boardId: z.uuid() });
export const FormTokenParams = z.object({ token: z.string().min(1).max(200) });

const brandingPatch = z
  .object({
    logoUrl: z.url().nullable().optional(),
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    thankYouMessage: z.string().trim().max(2000).nullable().optional(),
    redirectUrl: z.url().nullable().optional(),
  })
  .strict();

export const FormBrandingSchema = z.object({
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  thankYouMessage: z.string().nullable(),
  redirectUrl: z.string().nullable(),
});

export const FormSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  targetGroupId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  isPublic: z.boolean(),
  requiresLogin: z.boolean(),
  isActive: z.boolean(),
  closesAt: z.string().nullable(),
  settings: FormBrandingSchema,
  hasPublicLink: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateFormBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).nullable().optional(),
    targetGroupId: z.uuid().nullable().optional(),
  })
  .strict();

export const UpdateFormBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    targetGroupId: z.uuid().nullable().optional(),
    requiresLogin: z.boolean().optional(),
    isActive: z.boolean().optional(),
    closesAt: z.iso.datetime({ offset: true }).nullable().optional(),
    settings: brandingPatch.optional(),
  })
  .strict();

export const SetPublicBody = z.object({ isPublic: z.boolean() }).strict();
export const PublicLinkResponse = z.object({
  form: FormSchema,
  token: z.string().nullable(),
});

const fieldType = z.string().trim().min(1).max(40);
export const FieldPositionBody = z
  .object({ afterId: z.uuid().optional(), beforeId: z.uuid().optional() })
  .strict();

export const FormFieldSchema = z.object({
  id: z.uuid(),
  formId: z.uuid(),
  columnKey: z.string().nullable(),
  label: z.string(),
  helpText: z.string().nullable(),
  fieldType: z.string(),
  isRequired: z.boolean(),
  showWhen: FilterGroupSchema.nullable(),
  settings: z.record(z.string(), z.unknown()),
  position: z.string(),
});

export const UpsertFieldBody = z
  .object({
    columnKey: z.string().min(1).max(100).nullable().optional(),
    label: z.string().trim().min(1).max(200).optional(),
    helpText: z.string().trim().max(1000).nullable().optional(),
    fieldType: fieldType.optional(),
    isRequired: z.boolean().optional(),
    showWhen: FilterGroupSchema.nullable().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    position: FieldPositionBody.optional(),
  })
  .strict();

// --------------------------------------------------------------------------------- envio ---

const answers = z.record(z.string(), z.unknown());

export const SubmitInternalBody = z.object({ answers }).strict();

export const SubmitPublicBody = z
  .object({
    answers,
    honeypot: z.string().max(500).optional(),
    captcha: z.object({ token: z.string().min(1), answer: z.number() }).optional(),
  })
  .strict();

export const PublicFieldSchema = FormFieldSchema.extend({
  columnType: z.string().nullable(),
  labels: z.array(
    z.object({ id: z.uuid(), label: z.string(), color: z.string(), category: z.string() }),
  ),
  options: z.array(z.object({ id: z.uuid(), label: z.string(), color: z.string().nullable() })),
});

export const PublicFormDefinitionSchema = z.object({
  formId: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  requiresLogin: z.boolean(),
  branding: FormBrandingSchema,
  fields: z.array(PublicFieldSchema),
  captcha: z.object({ token: z.string(), question: z.string() }).nullable(),
});

export const SubmitResultSchema = z.object({
  itemId: z.uuid(),
  branding: FormBrandingSchema,
});
