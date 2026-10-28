import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from './workspace-scope.js';

const { resourceProfiles, users, workCalendars } = schema;

type ProfileRow = typeof resourceProfiles.$inferSelect;

export interface ResourceProfileDto {
  userId: string;
  userName: string;
  jobTitle: string | null;
  department: string | null;
  managerId: string | null;
  managerName: string | null;
  capacityHoursPerWeek: string;
  costRateHour: string | null;
  billRateHour: string | null;
  workCalendarId: string | null;
  location: string | null;
}

export interface UpsertResourceProfileInput {
  jobTitle?: string | null | undefined;
  department?: string | null | undefined;
  managerId?: string | null | undefined;
  capacityHoursPerWeek?: string | undefined;
  costRateHour?: string | null | undefined;
  billRateHour?: string | null | undefined;
  workCalendarId?: string | null | undefined;
  location?: string | null | undefined;
}

function toDto(
  row: ProfileRow,
  userName: string,
  managerName: string | null,
): ResourceProfileDto {
  return {
    userId: row.userId,
    userName,
    jobTitle: row.jobTitle,
    department: row.department,
    managerId: row.managerId,
    managerName,
    capacityHoursPerWeek: row.capacityHoursPerWeek,
    costRateHour: row.costRateHour,
    billRateHour: row.billRateHour,
    workCalendarId: row.workCalendarId,
    location: row.location,
  };
}

/** Perfis de recurso (ADR 0052): cargo, skills, custo, jornada e calendário pessoal de cada usuário. */
@Injectable()
export class ResourceProfilesService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
  ) {}

  /** Todos os perfis do tenant — requer `resources.manage` no workspace principal. */
  async list(user: AuthPrincipal): Promise<ResourceProfileDto[]> {
    await this.assertManage(user);
    const rows = await this.runner.tx
      .select({ profile: resourceProfiles, userName: users.name })
      .from(resourceProfiles)
      .innerJoin(users, eq(users.id, resourceProfiles.userId))
      .where(isNull(resourceProfiles.deletedAt));
    const managerIds = [...new Set(rows.map((row) => row.profile.managerId).filter((id) => id !== null))];
    const managerNames = new Map<string, string>();
    if (managerIds.length > 0) {
      const managers = await this.runner.tx
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, managerIds));
      for (const manager of managers) managerNames.set(manager.id, manager.name);
    }
    return rows.map((row) =>
      toDto(row.profile, row.userName, row.profile.managerId === null ? null : (managerNames.get(row.profile.managerId) ?? null)),
    );
  }

  async get(user: AuthPrincipal, targetUserId: string): Promise<ResourceProfileDto> {
    if (targetUserId !== user.userId) await this.assertManage(user);
    const row = await loadProfileOrDefault(this.runner.tx, targetUserId);
    const [owner] = await this.runner.tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, targetUserId));
    if (owner === undefined) throw new NotFoundError('Usuário');
    const managerName =
      row.managerId === null
        ? null
        : ((
            await this.runner.tx
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, row.managerId))
          )[0]?.name ?? null);
    return toDto(row, owner.name, managerName);
  }

  async upsert(
    user: AuthPrincipal,
    targetUserId: string,
    input: UpsertResourceProfileInput,
  ): Promise<ResourceProfileDto> {
    await this.assertManage(user);
    if (input.managerId !== undefined && input.managerId === targetUserId) {
      throw new ValidationError([
        { path: 'body.managerId', message: 'Uma pessoa não pode ser gestora de si mesma.' },
      ]);
    }
    const [owner] = await this.runner.tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetUserId));
    if (owner === undefined) throw new NotFoundError('Usuário');
    if (input.managerId !== undefined && input.managerId !== null) {
      const [manager] = await this.runner.tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.managerId));
      if (manager === undefined)
        throw new ValidationError([{ path: 'body.managerId', message: 'Gestor não encontrado.' }]);
    }
    if (input.workCalendarId !== undefined && input.workCalendarId !== null) {
      const [calendar] = await this.runner.tx
        .select({ id: workCalendars.id })
        .from(workCalendars)
        .where(and(eq(workCalendars.id, input.workCalendarId), isNull(workCalendars.deletedAt)));
      if (calendar === undefined)
        throw new ValidationError([
          { path: 'body.workCalendarId', message: 'Calendário não encontrado.' },
        ]);
    }
    const existing = await loadProfileOrDefault(this.runner.tx, targetUserId);
    const values = {
      tenantId: user.tenantId,
      userId: targetUserId,
      jobTitle: input.jobTitle === undefined ? existing.jobTitle : input.jobTitle,
      department: input.department === undefined ? existing.department : input.department,
      managerId: input.managerId === undefined ? existing.managerId : input.managerId,
      capacityHoursPerWeek: input.capacityHoursPerWeek ?? existing.capacityHoursPerWeek,
      costRateHour: input.costRateHour === undefined ? existing.costRateHour : input.costRateHour,
      billRateHour: input.billRateHour === undefined ? existing.billRateHour : input.billRateHour,
      workCalendarId: input.workCalendarId === undefined ? existing.workCalendarId : input.workCalendarId,
      location: input.location === undefined ? existing.location : input.location,
      createdBy: user.userId,
    };
    const [row] = await this.runner.tx
      .insert(resourceProfiles)
      .values(values)
      .onConflictDoUpdate({
        target: [resourceProfiles.tenantId, resourceProfiles.userId],
        set: {
          jobTitle: values.jobTitle,
          department: values.department,
          managerId: values.managerId,
          capacityHoursPerWeek: values.capacityHoursPerWeek,
          costRateHour: values.costRateHour,
          billRateHour: values.billRateHour,
          workCalendarId: values.workCalendarId,
          location: values.location,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao salvar perfil de recurso.');
    return this.get(user, targetUserId);
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, 'resources.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
  }
}

/**
 * Carrega o perfil de recurso de alguém, ou um registro-padrão em memória (jornada 40h, sem custo,
 * sem calendário próprio) quando a pessoa nunca configurou um — usado tanto aqui quanto pelo motor
 * de capacidade (ADR 0052), que precisa de uma jornada para todo mundo, configurado ou não.
 */
export async function loadProfileOrDefault(
  tx: Transaction,
  targetUserId: string,
): Promise<ProfileRow> {
  const [row] = await tx
    .select()
    .from(resourceProfiles)
    .where(and(eq(resourceProfiles.userId, targetUserId), isNull(resourceProfiles.deletedAt)));
  if (row !== undefined) return row;
  return {
    id: '',
    tenantId: '',
    userId: targetUserId,
    jobTitle: null,
    department: null,
    managerId: null,
    capacityHoursPerWeek: '40',
    costRateHour: null,
    billRateHour: null,
    workCalendarId: null,
    location: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    deletedAt: null,
  } satisfies ProfileRow;
}
