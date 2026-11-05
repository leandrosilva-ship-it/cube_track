import { Injectable } from '@nestjs/common';
import {
  ConsentRecordSchema,
  CreateDataSubjectRequestSchema,
  DecideDataSubjectRequestSchema,
  type ConsentRecordInput,
  type CreateDataSubjectRequest,
  type DecideDataSubjectRequest,
} from '@cube-track/shared';

import type { AuthPrincipal } from '../../../core/context/request-context.js';
import { TransactionRunner } from '../../../core/database/transaction-runner.js';
import { DomainEvents } from '../../../core/events/domain-events.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../core/errors/problems.js';
import { AccessService } from '../../access/application/access.service.js';
import { AuthService } from '../../identity/application/auth.service.js';
import { AuditRepository } from '../infrastructure/audit.repository.js';
import { LgpdRepository, type DataSubjectRequestRow } from '../infrastructure/lgpd.repository.js';

export interface PersonalDataExport {
  exportedAt: string;
  profile: { id: string; email: string; name: string; locale: string; createdAt: string } | null;
  memberships: { tenantId: string; roleKey: string; kind: string }[];
  consents: { purpose: string; granted: boolean; policyVersion: string; createdAt: string }[];
  /** Entradas de auditoria em que este usuário é o ATOR, no tenant corrente (até 1000 mais
   * recentes — um export completo e sem limite usa `GET /v1/audit/entries/export`, que exige
   * `audit.export`). */
  auditEntriesAsActor: { action: string; entityType: string; entityId: string | null; createdAt: string }[];
  /** Lacunas conhecidas (honestas) desta exportação — ver `docs/lgpd.md`. */
  outOfScope: string[];
}

const OUT_OF_SCOPE = [
  'Comentários/atualizações de item (collaboration.updates/replies) criados pelo usuário',
  'Itens dos quais o usuário é responsável (colunas people) — use a busca/filtro normal do board',
  'Apontamentos de horas (timesheet) e registros de capacidade',
];

function requestDto(row: DataSubjectRequestRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    executedAt: row.executedAt?.toISOString() ?? null,
  };
}
export type DataSubjectRequestDto = ReturnType<typeof requestDto>;

/**
 * LGPD (ADR 0057): consentimento (append-only, autosserviço), solicitações de titular (exportação
 * imediata; exclusão com fluxo requested → approved → executed) e a exportação de dados pessoais.
 * `dataRetentionPolicies` (Prompt 2, `governance.ts`) continua à parte — ver worker `purgeAuditLogs`.
 */
@Injectable()
export class LgpdService {
  constructor(
    private readonly runner: TransactionRunner,
    private readonly access: AccessService,
    private readonly repository: LgpdRepository,
    private readonly audit: AuditRepository,
    private readonly auth: AuthService,
    private readonly events: DomainEvents,
  ) {}

  // ------------------------------------------------------------------------------ consentimento ---

  async recordConsent(user: AuthPrincipal, input: ConsentRecordInput) {
    const parsed = ConsentRecordSchema.parse(input);
    const row = await this.repository.addConsent(this.runner.tx, {
      tenantId: user.tenantId,
      userId: user.userId,
      purpose: parsed.purpose,
      granted: parsed.granted,
      policyVersion: parsed.policyVersion,
      createdBy: user.userId,
    });
    this.events.recordChange({
      action: 'lgpd.consent_recorded',
      entityType: 'consent_record',
      entityId: row.id,
      after: { purpose: row.purpose, granted: row.granted },
    });
    return { id: row.id, purpose: row.purpose, granted: row.granted, createdAt: row.createdAt.toISOString() };
  }

  async myConsents(user: AuthPrincipal) {
    const rows = await this.repository.listConsents(this.runner.tx, user.tenantId, user.userId);
    return rows.map((row) => ({
      purpose: row.purpose,
      granted: row.granted,
      policyVersion: row.policyVersion,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  // ----------------------------------------------------------------------- solicitações de titular ---

  /** Exportação: executada IMEDIATAMENTE (dado do próprio titular, sem efeito destrutivo — não
   * precisa do fluxo de aprovação). Exclusão: fica `requested`, aguardando `lgpd.manage`. */
  async createRequest(user: AuthPrincipal, input: CreateDataSubjectRequest) {
    const parsed = CreateDataSubjectRequestSchema.parse(input);
    const row = await this.repository.createRequest(this.runner.tx, {
      tenantId: user.tenantId,
      userId: user.userId,
      kind: parsed.kind,
      reason: parsed.reason,
      createdBy: user.userId,
    });
    this.events.recordChange({
      action: 'lgpd.request_created',
      entityType: 'data_subject_request',
      entityId: row.id,
      after: { kind: row.kind },
    });
    if (parsed.kind === 'export') {
      await this.repository.updateRequest(this.runner.tx, user.tenantId, row.id, {
        status: 'executed',
        executedAt: new Date(),
      });
      return requestDto({ ...row, status: 'executed', executedAt: new Date() });
    }
    return requestDto(row);
  }

  async myRequests(user: AuthPrincipal): Promise<DataSubjectRequestDto[]> {
    const rows = await this.repository.listRequests(this.runner.tx, user.tenantId, user.userId);
    return rows.map(requestDto);
  }

  async listAllRequests(user: AuthPrincipal): Promise<DataSubjectRequestDto[]> {
    await this.access.assert(user, 'lgpd.manage', { type: 'tenant' });
    const rows = await this.repository.listRequests(this.runner.tx, user.tenantId, null);
    return rows.map(requestDto);
  }

  async decide(user: AuthPrincipal, requestId: string, input: DecideDataSubjectRequest) {
    await this.access.assert(user, 'lgpd.manage', { type: 'tenant' });
    const parsed = DecideDataSubjectRequestSchema.parse(input);
    const row = await this.repository.findRequest(this.runner.tx, user.tenantId, requestId);
    if (row === null) throw new NotFoundError('Solicitação');
    if (row.status !== 'requested') {
      throw new ConflictError('Esta solicitação já foi decidida.', 'request_already_decided');
    }
    await this.repository.updateRequest(this.runner.tx, user.tenantId, requestId, {
      status: parsed.status,
      decisionNote: parsed.decisionNote,
      decidedBy: user.userId,
      decidedAt: new Date(),
    });
    this.events.recordChange({
      action: 'lgpd.request_decided',
      entityType: 'data_subject_request',
      entityId: requestId,
      after: { status: parsed.status },
    });
    return requestDto({ ...row, status: parsed.status, decidedAt: new Date() });
  }

  /** Aplica uma exclusão APROVADA — anonimiza o usuário (`AuthService.anonymizeUser`), nunca exclui
   * de verdade (integridade referencial com auditoria/outbox/itens criados). */
  async execute(user: AuthPrincipal, requestId: string) {
    await this.access.assert(user, 'lgpd.manage', { type: 'tenant' });
    const row = await this.repository.findRequest(this.runner.tx, user.tenantId, requestId);
    if (row === null) throw new NotFoundError('Solicitação');
    if (row.kind !== 'erasure') {
      throw new ValidationError([{ path: 'kind', message: 'Só solicitações de exclusão são executadas por aqui.' }]);
    }
    if (row.status !== 'approved') {
      throw new ForbiddenError('A solicitação precisa estar aprovada antes de ser executada.', 'request_not_approved');
    }
    await this.auth.anonymizeUser(row.userId);
    await this.repository.updateRequest(this.runner.tx, user.tenantId, requestId, {
      status: 'executed',
      executedAt: new Date(),
    });
    this.events.recordChange({
      action: 'lgpd.request_executed',
      entityType: 'data_subject_request',
      entityId: requestId,
    });
    return requestDto({ ...row, status: 'executed', executedAt: new Date() });
  }

  // ---------------------------------------------------------------------------------- exportação ---

  async exportPersonalData(user: AuthPrincipal): Promise<PersonalDataExport> {
    const profile = await this.auth.profile(user.userId);
    const memberships = await this.auth.organizations(user.userId);
    const consents = await this.myConsents(user);
    const auditRows: PersonalDataExport['auditEntriesAsActor'] = [];
    let count = 0;
    for await (const entry of this.audit.searchAll(this.runner.tx, user.tenantId, { actorId: user.userId })) {
      auditRows.push({
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        createdAt: entry.createdAt.toISOString(),
      });
      count += 1;
      if (count >= 1_000) break;
    }
    return {
      exportedAt: new Date().toISOString(),
      profile:
        profile === null
          ? null
          : {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              locale: profile.locale,
              createdAt: profile.createdAt.toISOString(),
            },
      memberships: memberships.map((membership) => ({
        tenantId: membership.tenantId,
        roleKey: membership.roleKey,
        kind: membership.kind,
      })),
      consents,
      auditEntriesAsActor: auditRows,
      outOfScope: OUT_OF_SCOPE,
    };
  }
}
