import { Injectable } from '@nestjs/common';
import { schema, type Transaction } from '@cube-track/db';
import { and, desc, eq } from 'drizzle-orm';

const { consentRecords, dataSubjectRequests } = schema;

export type ConsentRow = typeof consentRecords.$inferSelect;
export type DataSubjectRequestRow = typeof dataSubjectRequests.$inferSelect;

/** `consent_records` (append-only) e `data_subject_requests` (ADR 0057, LGPD). */
@Injectable()
export class LgpdRepository {
  async addConsent(
    tx: Transaction,
    values: typeof consentRecords.$inferInsert,
  ): Promise<ConsentRow> {
    const [row] = await tx.insert(consentRecords).values(values).returning();
    if (row === undefined) throw new Error('Falha ao registrar o consentimento.');
    return row;
  }

  async listConsents(tx: Transaction, tenantId: string, userId: string): Promise<ConsentRow[]> {
    return tx
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.tenantId, tenantId), eq(consentRecords.userId, userId)))
      .orderBy(desc(consentRecords.createdAt));
  }

  async createRequest(
    tx: Transaction,
    values: typeof dataSubjectRequests.$inferInsert,
  ): Promise<DataSubjectRequestRow> {
    const [row] = await tx.insert(dataSubjectRequests).values(values).returning();
    if (row === undefined) throw new Error('Falha ao registrar a solicitação.');
    return row;
  }

  async listRequests(
    tx: Transaction,
    tenantId: string,
    userId: string | null,
  ): Promise<DataSubjectRequestRow[]> {
    const conditions = [eq(dataSubjectRequests.tenantId, tenantId)];
    if (userId !== null) conditions.push(eq(dataSubjectRequests.userId, userId));
    return tx
      .select()
      .from(dataSubjectRequests)
      .where(and(...conditions))
      .orderBy(desc(dataSubjectRequests.createdAt));
  }

  async findRequest(
    tx: Transaction,
    tenantId: string,
    id: string,
  ): Promise<DataSubjectRequestRow | null> {
    const [row] = await tx
      .select()
      .from(dataSubjectRequests)
      .where(and(eq(dataSubjectRequests.tenantId, tenantId), eq(dataSubjectRequests.id, id)));
    return row ?? null;
  }

  async updateRequest(
    tx: Transaction,
    tenantId: string,
    id: string,
    values: Partial<typeof dataSubjectRequests.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(dataSubjectRequests)
      .set(values)
      .where(and(eq(dataSubjectRequests.tenantId, tenantId), eq(dataSubjectRequests.id, id)));
  }
}
