import { z } from 'zod';

/** Documento do editor (Tiptap): validado estruturalmente no domínio, não campo a campo aqui. */
export const DocSchema = z.record(z.string(), z.unknown());

export const UpdateBodySchema = z.object({ body: DocSchema });

export const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30),
  cursor: z.string().max(2_000).optional(),
});

export const PinBodySchema = z.object({ pinned: z.boolean() });

export const ReactionParams = z.object({ id: z.uuid() });
export const ReactionBodySchema = z.object({ emoji: z.string().min(1).max(32) });

export const ActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(2_000).optional(),
  actorId: z.uuid().optional(),
  columnKey: z.string().max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const CreateChecklistBodySchema = z.object({ title: z.string().trim().min(1).max(200) });
export const RenameChecklistBodySchema = z.object({ title: z.string().trim().min(1).max(200) });
export const AddChecklistItemBodySchema = z.object({
  content: z.string().trim().min(1).max(2_000),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
});
export const UpdateChecklistItemBodySchema = z.object({
  content: z.string().trim().min(1).max(2_000).optional(),
  isDone: z.boolean().optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: z.iso.date().nullable().optional(),
});

export const FollowBodySchema = z.object({ following: z.boolean() });

export const RequestApprovalBodySchema = z.object({
  approverIds: z.array(z.uuid()).min(1).max(20),
  mode: z.enum(['all', 'any']).default('any'),
  note: z.string().trim().max(2_000).nullable().optional(),
});
export const DecideApprovalBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().trim().max(2_000).nullable().optional(),
});

export const InboundEmailBodySchema = z.object({
  to: z.array(z.string().min(3).max(500)).min(1).max(20),
  text: z.string().max(200_000),
});
