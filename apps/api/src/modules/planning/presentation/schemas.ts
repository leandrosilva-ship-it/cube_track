import { z } from 'zod';

export const BoardParams = z.object({ boardId: z.uuid() });

const dependencyType = z.enum(['FS', 'SS', 'FF', 'SF']);

export const GanttTaskSchema = z.object({
  id: z.uuid(),
  parentItemId: z.uuid().nullable(),
  groupId: z.uuid(),
  name: z.string(),
  wbs: z.string().nullable(),
  position: z.string(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  replannedStartDate: z.string().nullable(),
  replannedEndDate: z.string().nullable(),
  actualStartDate: z.string().nullable(),
  actualEndDate: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  progress: z.string().nullable(),
  isMilestone: z.boolean(),
  scheduleMode: z.enum(['auto', 'manual']),
});

export const GanttDependencySchema = z.object({
  id: z.uuid(),
  predecessorId: z.uuid(),
  successorId: z.uuid(),
  type: dependencyType,
  lagDays: z.number().int(),
});

export const CriticalPathEntrySchema = z.object({
  id: z.uuid(),
  earlyStart: z.string(),
  earlyFinish: z.string(),
  lateStart: z.string(),
  lateFinish: z.string(),
  totalFloatDays: z.number().int(),
  isCritical: z.boolean(),
});

export const GanttResponseSchema = z.object({
  tasks: z.array(GanttTaskSchema),
  dependencies: z.array(GanttDependencySchema),
  criticalPath: z.array(CriticalPathEntrySchema),
  calendar: z.object({
    workingDays: z.array(z.number().int()),
    holidays: z.array(z.string()),
  }),
});

// --------------------------------------------------------------------------------- marcos ---

const milestoneStatus = z.enum(['pending', 'achieved', 'missed', 'cancelled']);

export const MilestoneSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  itemId: z.uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  dueDate: z.iso.date(),
  status: milestoneStatus,
  achievedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateMilestoneBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  dueDate: z.iso.date(),
  itemId: z.uuid().nullable().optional(),
  status: milestoneStatus.optional(),
});

export const UpdateMilestoneBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    dueDate: z.iso.date().optional(),
    itemId: z.uuid().nullable().optional(),
    status: milestoneStatus.optional(),
  })
  .strict();

// ------------------------------------------------------------------------------ baselines ---

export const BaselineSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  capturedAt: z.string(),
  isPrimary: z.boolean(),
});

export const CaptureBaselineBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
});

export const BaselineComparisonRowSchema = z.object({
  itemId: z.uuid(),
  itemName: z.string(),
  baselineStartDate: z.string().nullable(),
  baselineEndDate: z.string().nullable(),
  baselineProgress: z.string().nullable(),
  plannedStartDate: z.string().nullable(),
  plannedEndDate: z.string().nullable(),
  replannedStartDate: z.string().nullable(),
  replannedEndDate: z.string().nullable(),
  actualStartDate: z.string().nullable(),
  actualEndDate: z.string().nullable(),
  currentProgress: z.string().nullable(),
});

export const BaselineDetailSchema = BaselineSchema.extend({
  items: z.array(BaselineComparisonRowSchema),
});

// ------------------------------------------------------------- import de cronograma (MS Project) ---

export const ImportParams = z.object({ boardId: z.uuid(), importId: z.uuid() });

export const ScheduleImportUploadBody = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    contentBase64: z.string().min(1).max(14_000_000),
  })
  .strict();

export const SchedulePreviewSchema = z.object({
  importId: z.uuid(),
  fileName: z.string(),
  totalTasks: z.number().int(),
  sample: z.array(
    z.object({
      name: z.string(),
      start: z.string().nullable(),
      finish: z.string().nullable(),
      milestone: z.boolean(),
    }),
  ),
  dependencyCount: z.number().int(),
  warnings: z.array(z.string()),
});

export const ScheduleImportCommitBody = z.object({ groupId: z.uuid() }).strict();

export const ScheduleImportResultSchema = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  dependenciesCreated: z.number().int(),
  errors: z.array(z.object({ task: z.string(), message: z.string() })),
});
