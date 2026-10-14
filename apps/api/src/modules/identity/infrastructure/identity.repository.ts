import { Inject, Injectable } from '@nestjs/common';
import { schema, type DatabaseHandle } from '@cube-track/db';
import { newId } from '@cube-track/shared';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';

import { AUTH_DB } from '../../../core/database/tokens.js';

const { users, sessions, authTokens, userIdentities, memberships, tenants, roles, invitations } =
  schema;

export type UserRecord = typeof users.$inferSelect;
export type SessionRecord = typeof sessions.$inferSelect;
export type AuthTokenPurpose = 'magic_link' | 'password_reset' | 'email_verification';
export type ExternalProvider = 'google' | 'microsoft' | 'saml' | 'oidc';

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  kind: 'member' | 'guest';
  roleKey: string;
}

/**
 * Acesso às tabelas de identidade com o papel `app_auth` (antes do contexto de tenant, ADR 0028).
 * Nenhuma tabela de negócio é acessada por aqui.
 */
@Injectable()
export class IdentityRepository {
  constructor(@Inject(AUTH_DB) private readonly database: DatabaseHandle) {}

  private get db() {
    return this.database.db;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    return row ?? null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async createUser(input: {
    email: string;
    name: string;
    passwordHash: string | null;
    emailVerified: boolean;
    locale?: string;
  }): Promise<UserRecord> {
    const [row] = await this.db
      .insert(users)
      .values({
        id: newId(),
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        passwordChangedAt: input.passwordHash === null ? null : new Date(),
        emailVerifiedAt: input.emailVerified ? new Date() : null,
        locale: input.locale ?? 'pt-BR',
      })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar usuário');
    return row;
  }

  async updateUser(id: string, values: Partial<typeof users.$inferInsert>): Promise<void> {
    await this.db.update(users).set(values).where(eq(users.id, id));
  }

  async registerFailedLogin(id: string, maxAttempts: number, lockMinutes: number): Promise<void> {
    await this.db
      .update(users)
      .set({
        failedLoginCount: sql`${users.failedLoginCount} + 1`,
        lockedUntil: sql`case when ${users.failedLoginCount} + 1 >= ${maxAttempts} then now() + make_interval(mins => ${lockMinutes}) else ${users.lockedUntil} end`,
      })
      .where(eq(users.id, id));
  }

  async listMemberships(userId: string): Promise<MembershipSummary[]> {
    return this.db
      .select({
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        kind: memberships.kind,
        roleKey: roles.key,
      })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          isNull(memberships.deletedAt),
          eq(tenants.status, 'active'),
          isNull(tenants.deletedAt),
        ),
      )
      .orderBy(asc(tenants.name));
  }

  async findMembership(userId: string, tenantId: string): Promise<MembershipSummary | null> {
    const list = await this.listMemberships(userId);
    return list.find((entry) => entry.tenantId === tenantId) ?? null;
  }

  // ---------------------------------------------------------------------------- sessões ---

  async createSession(input: {
    tenantId: string;
    userId: string;
    familyId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
    mfaVerified: boolean;
    authMethod: string;
  }): Promise<SessionRecord> {
    const [row] = await this.db
      .insert(sessions)
      .values({ id: newId(), ...input, lastSeenAt: new Date(), createdBy: input.userId })
      .returning();
    if (row === undefined) throw new Error('Falha ao criar sessão');
    return row;
  }

  async findSessionByTokenHash(hash: string): Promise<SessionRecord | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.refreshTokenHash, hash));
    return row ?? null;
  }

  async findSession(id: string): Promise<SessionRecord | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id));
    return row ?? null;
  }

  /** Marca a sessão como rotacionada; retorna false se outra requisição já a rotacionou. */
  async markRotated(id: string, replacedById: string): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: 'rotated', replacedById })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  async revokeFamily(familyId: string, reason: string): Promise<SessionRecord[]> {
    return this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)))
      .returning();
  }

  async revokeAllForUser(userId: string, reason: string): Promise<SessionRecord[]> {
    return this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning();
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }

  // ------------------------------------------------------------------ tokens de uso único ---

  async createAuthToken(input: {
    userId: string;
    tenantId: string | null;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
  }) {
    await this.db.insert(authTokens).values({ id: newId(), ...input, createdBy: input.userId });
  }

  /** Consome o token (uso único, não expirado). */
  async consumeAuthToken(tokenHash: string, purpose: AuthTokenPurpose) {
    const [row] = await this.db
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ?? null;
  }

  async invalidateAuthTokens(userId: string, purpose: AuthTokenPurpose): Promise<void> {
    await this.db
      .update(authTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.consumedAt),
        ),
      );
  }

  // ---------------------------------------------------------------- identidades externas ---

  async findIdentity(provider: ExternalProvider, subject: string) {
    const [row] = await this.db
      .select()
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)));
    return row ?? null;
  }

  async linkIdentity(
    userId: string,
    provider: ExternalProvider,
    subject: string,
    email: string | null,
  ): Promise<void> {
    await this.db
      .insert(userIdentities)
      .values({
        id: newId(),
        userId,
        provider,
        subject,
        email,
        lastLoginAt: new Date(),
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [userIdentities.provider, userIdentities.subject],
        set: { lastLoginAt: new Date(), email },
      });
  }

  // ------------------------------------------------------------------------------ convites ---

  async findInvitationByTokenHash(tokenHash: string) {
    const [row] = await this.db
      .select({ invitation: invitations, tenantName: tenants.name, tenantSlug: tenants.slug })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(eq(invitations.tokenHash, tokenHash));
    return row ?? null;
  }

  async findPendingInvitationByEmail(email: string, tenantId: string | null) {
    const rows = await this.db
      .select()
      .from(invitations)
      .where(
        and(
          eq(sql`lower(${invitations.email})`, email.toLowerCase()),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
          ...(tenantId === null ? [] : [eq(invitations.tenantId, tenantId)]),
        ),
      )
      .orderBy(asc(invitations.createdAt));
    return rows[0] ?? null;
  }

  async markInvitationAccepted(id: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedUserId: userId })
      .where(and(eq(invitations.id, id), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });
    return rows.length > 0;
  }
}
