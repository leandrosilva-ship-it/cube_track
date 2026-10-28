import { z } from 'zod';

export const UserParams = z.object({ userId: z.uuid() });
export const BoardParams = z.object({ boardId: z.uuid() });
export const WorkspaceParams = z.object({ workspaceId: z.uuid() });

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD).');
const hoursString = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Horas inválidas.');

const uuidList = z
  .string()
  .transform((value) => value.split(',').filter((entry) => entry.length > 0))
  .pipe(z.array(z.uuid()))
  .optional();

// ----------------------------------------------------------------------- Resource profiles ---

export const ResourceProfileSchema = z.object({
  userId: z.uuid(),
  userName: z.string(),
  jobTitle: z.string().nullable(),
  department: z.string().nullable(),
  managerId: z.uuid().nullable(),
  managerName: z.string().nullable(),
  capacityHoursPerWeek: z.string(),
  costRateHour: z.string().nullable(),
  billRateHour: z.string().nullable(),
  workCalendarId: z.uuid().nullable(),
  location: z.string().nullable(),
});

export const UpsertResourceProfileBody = z
  .object({
    jobTitle: z.string().max(200).nullable().optional(),
    department: z.string().max(200).nullable().optional(),
    managerId: z.uuid().nullable().optional(),
    capacityHoursPerWeek: hoursString.optional(),
    costRateHour: z.string().nullable().optional(),
    billRateHour: z.string().nullable().optional(),
    workCalendarId: z.uuid().nullable().optional(),
    location: z.string().max(200).nullable().optional(),
  })
  .strict();

// -------------------------------------------------------------------------------- Skills ---

export const TeamSchema = z.object({ id: z.uuid(), name: z.string() });

export const SkillSchema = z.object({ id: z.uuid(), name: z.string(), category: z.string().nullable() });
export const CreateSkillBody = z
  .object({ name: z.string().min(1).max(100), category: z.string().max(100).nullable().optional() })
  .strict();
export const UpdateSkillBody = z
  .object({ name: z.string().min(1).max(100).optional(), category: z.string().max(100).nullable().optional() })
  .strict();

export const UserSkillSchema = z.object({ skillId: z.uuid(), skillName: z.string(), level: z.number().int() });
export const SetUserSkillsBody = z
  .object({
    entries: z.array(z.object({ skillId: z.uuid(), level: z.number().int().min(1).max(5) })).max(100),
  })
  .strict();

// --------------------------------------------------------------------------- Allocations ---

export const AllocationSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  boardId: z.uuid(),
  itemId: z.uuid().nullable(),
  startDate: z.string(),
  endDate: z.string(),
  hoursPerDay: z.string(),
  status: z.enum(['tentative', 'confirmed']),
  notes: z.string().nullable(),
});

export const AllocationRangeQuery = z.object({ from: dateString.optional(), to: dateString.optional() });
export const AllocationUserRangeQuery = z.object({ from: dateString, to: dateString });

export const CreateAllocationBody = z
  .object({
    userId: z.uuid(),
    boardId: z.uuid(),
    itemId: z.uuid().nullable().optional(),
    startDate: dateString,
    endDate: dateString,
    hoursPerDay: hoursString,
    status: z.enum(['tentative', 'confirmed']).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const UpdateAllocationBody = z
  .object({
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    hoursPerDay: hoursString.optional(),
    status: z.enum(['tentative', 'confirmed']).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

// ------------------------------------------------------------------------------ Absences ---

export const AbsenceSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  type: z.enum(['vacation', 'sick_leave', 'training', 'day_off', 'other']),
  startDate: z.string(),
  endDate: z.string(),
  hoursPerDay: z.string().nullable(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected']),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.string().nullable(),
  notes: z.string().nullable(),
});

export const RequestAbsenceBody = z
  .object({
    startDate: dateString,
    endDate: dateString,
    type: z.enum(['vacation', 'sick_leave', 'training', 'day_off', 'other']),
    hoursPerDay: hoursString.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const DecideAbsenceBody = z.object({ status: z.enum(['approved', 'rejected']) }).strict();

// ----------------------------------------------------------------------- Resource requests ---

export const ResourceRequestSchema = z.object({
  id: z.uuid(),
  boardId: z.uuid(),
  itemId: z.uuid().nullable(),
  skillId: z.uuid().nullable(),
  roleTitle: z.string(),
  hours: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['open', 'fulfilled', 'cancelled']),
  assignedUserId: z.uuid().nullable(),
  notes: z.string().nullable(),
});

export const CreateResourceRequestBody = z
  .object({
    itemId: z.uuid().nullable().optional(),
    skillId: z.uuid().nullable().optional(),
    roleTitle: z.string().min(1).max(200),
    hours: hoursString,
    startDate: dateString,
    endDate: dateString,
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const AssignResourceRequestBody = z.object({ assignedUserId: z.uuid() }).strict();

// -------------------------------------------------------------------------------- Capacity ---

export const CapacityScopeQuery = z.object({
  from: dateString,
  to: dateString,
  granularity: z.enum(['day', 'week', 'month']).optional(),
  userIds: uuidList,
  teamIds: uuidList,
  skillId: z.uuid().optional(),
  boardId: z.uuid().optional(),
});

export const LevelingQuery = z.object({
  from: dateString,
  to: dateString,
  userIds: uuidList,
  teamIds: uuidList,
  skillId: z.uuid().optional(),
  boardId: z.uuid().optional(),
});

export const ForecastQuery = z.object({ months: z.coerce.number().int().refine((v) => v === 3 || v === 6 || v === 12, 'months deve ser 3, 6 ou 12') });

export const WhatIfBody = z
  .object({
    from: dateString,
    to: dateString,
    userId: z.uuid(),
    granularity: z.enum(['day', 'week', 'month']).optional(),
    hypotheticalAllocations: z
      .array(z.object({ startDate: dateString, endDate: dateString, hoursPerDay: hoursString }))
      .max(50),
  })
  .strict();

export const CapacityBucketSchema = z.object({
  bucket: z.string(),
  nominalHours: z.number(),
  availableHours: z.number(),
  allocatedHours: z.number(),
  utilization: z.number(),
  overallocated: z.boolean(),
});

export const HeatmapRowSchema = z.object({
  userId: z.uuid(),
  userName: z.string(),
  teamIds: z.array(z.uuid()),
  skillIds: z.array(z.uuid()),
  buckets: z.array(CapacityBucketSchema),
});

export const HeatmapResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  granularity: z.enum(['day', 'week', 'month']),
  rows: z.array(HeatmapRowSchema),
});

export const LevelingSuggestionSchema = z.object({
  userId: z.uuid(),
  allocationId: z.uuid(),
  fromDate: z.string(),
  toDate: z.string(),
  hours: z.number(),
});

export const ForecastBucketSchema = z.object({
  month: z.string(),
  capacityHours: z.number(),
  demandHours: z.number(),
  gapHours: z.number(),
});

export const WhatIfResponseSchema = z.object({
  real: z.array(CapacityBucketSchema),
  simulated: z.array(CapacityBucketSchema),
});
