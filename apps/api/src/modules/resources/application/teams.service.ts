import { Injectable } from '@nestjs/common';
import { schema } from '@cube-track/db';
import { isNull } from 'drizzle-orm';

import { TransactionRunner } from '../../../core/database/transaction-runner.js';

const { teams } = schema;

export interface TeamDto {
  id: string;
  name: string;
}

/**
 * Catálogo de times do tenant (ADR 0052): só leitura aqui — exibir nomes ao agrupar a Carga de
 * trabalho por time. CRUD de times fica fora do escopo deste prompt.
 */
@Injectable()
export class TeamsService {
  constructor(private readonly runner: TransactionRunner) {}

  /** Qualquer pessoa autenticada do tenant pode ler a lista (é só um vocabulário, sem dado sensível). */
  async list(): Promise<TeamDto[]> {
    const rows = await this.runner.tx
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(isNull(teams.deletedAt))
      .orderBy(teams.name);
    return rows;
  }
}
