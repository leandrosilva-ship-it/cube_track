import { z } from 'zod';

export const IdParams = z.object({ id: z.uuid() });

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    pageInfo: z.object({ nextCursor: z.string().nullable(), hasNextPage: z.boolean() }),
  });
}

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    code: z.string(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string(), code: z.string().optional() }))
      .optional(),
  })
  .loose();
