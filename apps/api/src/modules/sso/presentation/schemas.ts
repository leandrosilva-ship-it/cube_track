import { SamlAttributeMappingSchema, ScimPatchOperationSchema, ScimUserSchema } from '@cube-track/shared';
import { z } from 'zod';

export const TenantSlugParams = z.object({ tenantSlug: z.string().min(1).max(63) });

export const SsoConfigDtoSchema = z.object({
  isEnabled: z.boolean(),
  idpEntityId: z.string().nullable(),
  idpSsoUrl: z.string().nullable(),
  idpSloUrl: z.string().nullable(),
  metadataUrl: z.string().nullable(),
  hasCertificate: z.boolean(),
  attributeMapping: SamlAttributeMappingSchema,
  provisionOnFirstLogin: z.boolean(),
  defaultRoleKey: z.string(),
  updatedAt: z.string().nullable(),
});

export const UpdateSsoConfigBody = z.object({
  isEnabled: z.boolean().optional(),
  idpEntityId: z.string().min(1).max(2_000),
  idpSsoUrl: z.url(),
  idpSloUrl: z.url().nullable().optional(),
  idpCertificate: z.string().min(1),
  metadataUrl: z.url().nullable().optional(),
  attributeMapping: SamlAttributeMappingSchema.partial().optional(),
  provisionOnFirstLogin: z.boolean().optional(),
  defaultRoleKey: z.string().min(1).max(64).optional(),
});

export const AcsBody = z.object({
  SAMLResponse: z.string().min(1),
  RelayState: z.string().optional(),
});

export const ScimListQuery = z.object({
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(1).max(200).default(50),
  filter: z.string().optional(),
});

export const ScimIdParams = z.object({ id: z.string().min(1) });

export { ScimUserSchema, ScimPatchOperationSchema };
