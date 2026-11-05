import { IMPORT_SOURCES } from '@cube-track/shared';
import { z } from 'zod';

export const BoardIdParams = z.object({ boardId: z.uuid() });
export const ImportJobIdParams = z.object({ importJobId: z.uuid() });

export const ImportMappingTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ignore') }).strict(),
  z.object({ type: z.literal('name') }).strict(),
  z.object({ type: z.literal('group') }).strict(),
  z.object({ type: z.literal('column'), key: z.string().trim().min(1).max(60) }).strict(),
]);

/** Chaves são o índice (como string) da coluna da planilha de origem. */
export const ImportMappingSchema = z.record(z.string().regex(/^\d+$/, 'Índice inválido.'), ImportMappingTargetSchema);

export const PreviewBody = z
  .object({
    source: z.enum(IMPORT_SOURCES),
    fileName: z.string().trim().min(1).max(300),
    contentBase64: z.string().min(1).max(14_000_000),
  })
  .strict();

export const PreviewResponse = z.object({
  importJobId: z.uuid(),
  headers: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  totalRows: z.number().int(),
  suggestedMapping: ImportMappingSchema,
});

export const UpdateMappingBody = z.object({ mapping: ImportMappingSchema }).strict();

export const ImportJobSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  source: z.enum(IMPORT_SOURCES),
  status: z.enum(['uploaded', 'processing', 'completed', 'failed']),
  fileName: z.string(),
  mapping: ImportMappingSchema,
  totalRows: z.number().int(),
  createdCount: z.number().int().nullable(),
  skippedCount: z.number().int().nullable(),
  errorReport: z.array(z.object({ row: z.number().int(), message: z.string() })).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
