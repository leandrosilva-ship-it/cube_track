import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { positionBetween } from '@cube-track/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { AccessService } from '../../access/application/access.service.js';

const { programs } = schema;

type ProgramRow = typeof programs.$inferSelect;

export interface ProgramDto {
  id: string;
  workspaceId: string;
  portfolioId: string | null;
  name: string;
  description: string | null;
  ownerId: string | null;
  status: ProgramRow['status'];
  startDate: string | null;
  endDate: string | null;
}

export interface ProgramInput {
  name: string;
  description?: string | null | undefined;
  portfolioId?: string | null | undefined;
  ownerId?: string | null | undefined;
  status?: ProgramRow['status'] | undefined;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
}

export interface UpdateProgramInput {
  name?: string | undefined;
  description?: string | null | undefined;
  portfolioId?: string | null | undefined;
  ownerId?: string | null | undefined;
  status?: ProgramRow['status'] | undefined;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
}

function toDto(row: ProgramRow): ProgramDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    portfolioId: row.portfolioId,
    name: row.name,
    description: row.description,
    ownerId: row.ownerId,
    status: row.status,
    startDate: row.startDate,
    endDate: row.endDate,
  };
}

function assertDates(startDate: string | null | undefined, endDate: string | null | undefined): void {
  if (startDate !== null && startDate !== undefined && endDate !== null && endDate !== undefined && endDate < startDate)
    throw new ValidationError([{ path: 'body.endDate', message: 'O fim não pode ser antes do início.' }]);
}

/** Programas (ADR 0053): agrupam projetos (boards) relacionados, opcionalmente num portfólio. */
@Injectable()
export class ProgramsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly events: DomainEvents,
  ) {}

  async list(user: AuthPrincipal, workspaceId: string): Promise<ProgramDto[]> {
    await this.access.assert(user, 'workspace.read', { type: 'workspace', id: workspaceId }, 'Workspace');
    const rows = await this.runner.tx
      .select()
      .from(programs)
      .where(and(eq(programs.workspaceId, workspaceId), isNull(programs.deletedAt)))
      .orderBy(asc(programs.position));
    return rows.map(toDto);
  }

  async get(user: AuthPrincipal, id: string): Promise<ProgramDto> {
    const row = await this.locked(id);
    await this.access.assert(user, 'workspace.read', { type: 'workspace', id: row.workspaceId }, 'Workspace');
    return toDto(row);
  }

  async create(user: AuthPrincipal, workspaceId: string, input: ProgramInput): Promise<ProgramDto> {
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
    assertDates(input.startDate, input.endDate);
    const [last] = await this.runner.tx
      .select({ position: programs.position })
      .from(programs)
      .where(and(eq(programs.workspaceId, workspaceId), isNull(programs.deletedAt)))
      .orderBy(asc(programs.position));
    const [row] = await this.runner.tx
      .insert(programs)
      .values({
        tenantId: user.tenantId,
        workspaceId,
        portfolioId: input.portfolioId ?? null,
        name: input.name,
        description: input.description ?? null,
        ownerId: input.ownerId ?? null,
        status: input.status ?? 'active',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        position: positionBetween(last?.position ?? null, null),
        createdBy: user.userId,
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar programa.');
    this.events.recordChange({ action: 'program.create', entityType: 'program', entityId: row.id, after: { name: row.name } });
    await this.emitChanged(user, row, 'created');
    return toDto(row);
  }

  async update(user: AuthPrincipal, id: string, input: UpdateProgramInput): Promise<ProgramDto> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: existing.workspaceId }, 'Workspace');
    const startDate = input.startDate === undefined ? existing.startDate : input.startDate;
    const endDate = input.endDate === undefined ? existing.endDate : input.endDate;
    assertDates(startDate, endDate);
    const [row] = await this.runner.tx
      .update(programs)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        portfolioId: input.portfolioId === undefined ? existing.portfolioId : input.portfolioId,
        ownerId: input.ownerId === undefined ? existing.ownerId : input.ownerId,
        status: input.status ?? existing.status,
        startDate,
        endDate,
        updatedAt: new Date(),
      })
      .where(eq(programs.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar programa.');
    this.events.recordChange({
      action: 'program.update',
      entityType: 'program',
      entityId: row.id,
      before: { name: existing.name },
      after: { name: row.name },
    });
    await this.emitChanged(user, row, 'updated');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    const existing = await this.locked(id);
    await this.access.assert(user, 'portfolio.manage', { type: 'workspace', id: existing.workspaceId }, 'Workspace');
    await this.runner.tx.update(programs).set({ deletedAt: new Date() }).where(eq(programs.id, id));
    this.events.recordChange({ action: 'program.delete', entityType: 'program', entityId: id });
    await this.emitChanged(user, existing, 'deleted');
  }

  private async locked(id: string): Promise<ProgramRow> {
    const [row] = await this.runner.tx.select().from(programs).where(eq(programs.id, id));
    if (row === undefined) throw new NotFoundError('Programa');
    return row;
  }

  private async emitChanged(
    user: AuthPrincipal,
    row: Pick<ProgramRow, 'id' | 'workspaceId' | 'portfolioId'>,
    change: 'created' | 'updated' | 'deleted',
  ): Promise<void> {
    await this.events.emit({
      tenantId: user.tenantId,
      type: 'program.changed',
      aggregateType: 'program',
      aggregateId: row.id,
      payload: { programId: row.id, workspaceId: row.workspaceId, portfolioId: row.portfolioId, change },
      actorId: user.userId,
    });
  }
}

export type { ProgramRow };
