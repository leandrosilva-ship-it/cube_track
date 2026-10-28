import { z } from 'zod';

export const UserParams = z.object({ userId: z.uuid() });
export const ItemParams = z.object({ itemId: z.uuid() });

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD).');

export const TimeEntrySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  boardId: z.uuid(),
  itemId: z.uuid(),
  entryDate: z.string(),
  minutes: z.number().int(),
  description: z.string().nullable(),
  isBillable: z.boolean(),
  source: z.enum(['manual', 'timer', 'import', 'api']),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
  approvalId: z.uuid().nullable(),
});

export const UserRangeQuery = z.object({ from: dateString, to: dateString });

export const CreateTimeEntryBody = z
  .object({
    boardId: z.uuid(),
    itemId: z.uuid(),
    entryDate: dateString,
    minutes: z.number().int().min(1).max(1440),
    description: z.string().max(2000).nullable().optional(),
    isBillable: z.boolean().optional(),
  })
  .strict();

export const LogWeekBody = z.object({ entries: z.array(CreateTimeEntryBody).min(1).max(100) }).strict();

export const UpdateTimeEntryBody = z
  .object({
    entryDate: dateString.optional(),
    minutes: z.number().int().min(1).max(1440).optional(),
    description: z.string().max(2000).nullable().optional(),
    isBillable: z.boolean().optional(),
  })
  .strict();

export const TimesheetApprovalSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
  totalMinutes: z.number().int(),
  submittedAt: z.string().nullable(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: z.string().nullable(),
  comment: z.string().nullable(),
});

export const SubmitWeekBody = z.object({ periodStart: dateString }).strict();
export const DecideApprovalBody = z
  .object({ status: z.enum(['approved', 'rejected']), comment: z.string().max(2000).nullable().optional() })
  .strict();

export const ExportQuery = z.object({ from: dateString, to: dateString });
