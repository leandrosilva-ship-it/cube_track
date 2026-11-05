import { CONSENT_PURPOSES, DATA_SUBJECT_REQUEST_KINDS } from '@cube-track/shared';
import { z } from 'zod';

export const RecordConsentBody = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  policyVersion: z.string().min(1).max(64),
});

export const ConsentSchema = z.object({
  purpose: z.string(),
  granted: z.boolean(),
  policyVersion: z.string(),
  createdAt: z.string(),
});

export const CreateRequestBody = z.object({
  kind: z.enum(DATA_SUBJECT_REQUEST_KINDS),
  reason: z.string().max(2_000).nullable().optional(),
});

export const DecideRequestBody = z.object({
  status: z.enum(['approved', 'rejected']),
  decisionNote: z.string().max(2_000).nullable().optional(),
});

export const RequestSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  executedAt: z.string().nullable(),
});

export const IdParams = z.object({ id: z.uuid() });

export const PersonalDataExportSchema = z.object({
  exportedAt: z.string(),
  profile: z
    .object({ id: z.uuid(), email: z.string(), name: z.string(), locale: z.string(), createdAt: z.string() })
    .nullable(),
  memberships: z.array(z.object({ tenantId: z.uuid(), roleKey: z.string(), kind: z.string() })),
  consents: z.array(ConsentSchema),
  auditEntriesAsActor: z.array(
    z.object({
      action: z.string(),
      entityType: z.string(),
      entityId: z.uuid().nullable(),
      createdAt: z.string(),
    }),
  ),
  outOfScope: z.array(z.string()),
});
