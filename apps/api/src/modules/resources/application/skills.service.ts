import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { primaryWorkspaceId } from './workspace-scope.js';

const { skills, userSkills } = schema;

type SkillRow = typeof skills.$inferSelect;

export interface SkillDto {
  id: string;
  name: string;
  category: string | null;
}

export interface UserSkillDto {
  skillId: string;
  skillName: string;
  level: number;
}

function toDto(row: SkillRow): SkillDto {
  return { id: row.id, name: row.name, category: row.category };
}

/** Catálogo de skills do tenant e competências por usuário (ADR 0052). */
@Injectable()
export class SkillsService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
  ) {}

  /** Qualquer pessoa autenticada do tenant pode ler o catálogo (é só um vocabulário, sem dado sensível). */
  async list(): Promise<SkillDto[]> {
    const rows = await this.runner.tx.select().from(skills).where(isNull(skills.deletedAt));
    return rows.map(toDto);
  }

  async create(
    user: AuthPrincipal,
    input: { name: string; category?: string | null | undefined },
  ): Promise<SkillDto> {
    await this.assertManage(user);
    const name = input.name.trim();
    if (name === '') throw new ValidationError([{ path: 'body.name', message: 'Informe um nome.' }]);
    const [existing] = await this.runner.tx
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.name, name), isNull(skills.deletedAt)));
    if (existing !== undefined) throw new ConflictError('Já existe uma skill com este nome.');
    const [row] = await this.runner.tx
      .insert(skills)
      .values({ tenantId: user.tenantId, name, category: input.category ?? null, createdBy: user.userId })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar skill.');
    return toDto(row);
  }

  async update(
    user: AuthPrincipal,
    id: string,
    input: { name?: string | undefined; category?: string | null | undefined },
  ): Promise<SkillDto> {
    await this.assertManage(user);
    const [existing] = await this.runner.tx
      .select()
      .from(skills)
      .where(and(eq(skills.id, id), isNull(skills.deletedAt)));
    if (existing === undefined) throw new NotFoundError('Skill');
    const name = input.name === undefined ? existing.name : input.name.trim();
    if (name === '') throw new ValidationError([{ path: 'body.name', message: 'Informe um nome.' }]);
    if (name.toLowerCase() !== existing.name.toLowerCase()) {
      const [duplicate] = await this.runner.tx
        .select({ id: skills.id })
        .from(skills)
        .where(and(eq(skills.name, name), isNull(skills.deletedAt)));
      if (duplicate !== undefined) throw new ConflictError('Já existe uma skill com este nome.');
    }
    const [row] = await this.runner.tx
      .update(skills)
      .set({ name, category: input.category === undefined ? existing.category : input.category, updatedAt: new Date() })
      .where(eq(skills.id, id))
      .returning();
    if (row === undefined) throw new Error('Falha ao atualizar skill.');
    return toDto(row);
  }

  async remove(user: AuthPrincipal, id: string): Promise<void> {
    await this.assertManage(user);
    const [existing] = await this.runner.tx
      .select({ id: skills.id })
      .from(skills)
      .where(and(eq(skills.id, id), isNull(skills.deletedAt)));
    if (existing === undefined) throw new NotFoundError('Skill');
    await this.runner.tx.update(skills).set({ deletedAt: new Date() }).where(eq(skills.id, id));
  }

  async listForUser(targetUserId: string): Promise<UserSkillDto[]> {
    const rows = await this.runner.tx
      .select({ skillId: userSkills.skillId, level: userSkills.level, skillName: skills.name })
      .from(userSkills)
      .innerJoin(skills, eq(skills.id, userSkills.skillId))
      .where(eq(userSkills.userId, targetUserId));
    return rows;
  }

  /** Substitui todas as competências da pessoa pela lista enviada. */
  async setForUser(
    user: AuthPrincipal,
    targetUserId: string,
    entries: { skillId: string; level: number }[],
  ): Promise<UserSkillDto[]> {
    await this.assertManage(user);
    const skillIds = entries.map((entry) => entry.skillId);
    if (skillIds.length > 0) {
      const found = await this.runner.tx
        .select({ id: skills.id })
        .from(skills)
        .where(and(inArray(skills.id, skillIds), isNull(skills.deletedAt)));
      if (found.length !== new Set(skillIds).size)
        throw new ValidationError([{ path: 'body', message: 'Uma ou mais skills não existem.' }]);
    }
    await this.runner.tx.delete(userSkills).where(eq(userSkills.userId, targetUserId));
    if (entries.length > 0) {
      await this.runner.tx.insert(userSkills).values(
        entries.map((entry) => ({
          tenantId: user.tenantId,
          userId: targetUserId,
          skillId: entry.skillId,
          level: entry.level,
          createdBy: user.userId,
        })),
      );
    }
    return this.listForUser(targetUserId);
  }

  private async assertManage(user: AuthPrincipal): Promise<void> {
    const workspaceId = await primaryWorkspaceId(this.runner.tx, user.tenantId);
    await this.access.assert(user, 'resources.manage', { type: 'workspace', id: workspaceId }, 'Workspace');
  }
}
