import { AUDIT_ACTOR_KINDS, AuditExportFormatSchema } from '@cube-track/shared';
import { z } from 'zod';

export const AuditSearchQuery = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  actorId: z.uuid().optional(),
  actorKind: z.enum(AUDIT_ACTOR_KINDS).optional(),
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.uuid().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().max(2_000).optional(),
});

export const AuditExportQuery = AuditSearchQuery.omit({ limit: true, cursor: true }).extend({
  format: AuditExportFormatSchema.default('ndjson'),
});

export const AuditEntrySchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  actorId: z.uuid().nullable(),
  actorKind: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const AuditSearchResponse = z.object({
  data: z.array(AuditEntrySchema),
  pageInfo: z.object({ nextCursor: z.string().nullable(), hasNextPage: z.boolean() }),
});
