import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseHandle } from '@cube-track/db';
import { sql } from 'drizzle-orm';

import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { APP_DB } from '../database/tokens.js';
import type { ResolvedTenant } from '../context/request-context.js';
import { ForbiddenError, NotFoundError } from '../errors/problems.js';

interface CachedTenant {
  tenantId: string;
  slug: string;
  status: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

/** Resolve o tenant pelo header `X-Tenant` (slug ou id) ou pelo subdomínio `{slug}.{BASE_DOMAIN}`. */
@Injectable()
export class TenantResolver {
  private readonly cache = new Map<string, CachedTenant>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_DB) private readonly database: DatabaseHandle,
  ) {}

  /** Extrai a referência do tenant (sem consultar o banco). */
  reference(
    host: string | undefined,
    header: string | undefined,
  ): { ref: string; source: ResolvedTenant['source'] } | null {
    if (header !== undefined && header.trim() !== '')
      return { ref: header.trim().toLowerCase(), source: 'header' };
    if (host === undefined) return null;
    const hostname = host.split(':')[0]?.toLowerCase() ?? '';
    const suffix = `.${this.config.BASE_DOMAIN.toLowerCase()}`;
    if (!hostname.endsWith(suffix)) return null;
    const slug = hostname.slice(0, -suffix.length);
    if (slug === 'www' || slug === 'app' || slug === 'api' || !SLUG_PATTERN.test(slug)) return null;
    return { ref: slug, source: 'subdomain' };
  }

  async resolve(ref: string, source: ResolvedTenant['source']): Promise<ResolvedTenant> {
    const cached = this.cache.get(ref);
    const now = Date.now();
    let entry = cached !== undefined && cached.expiresAt > now ? cached : undefined;
    if (entry === undefined) {
      const result = await this.database.db.execute<{
        tenant_id: string;
        slug: string;
        status: string;
      }>(sql`select tenant_id, slug, status from app.resolve_tenant(${ref})`);
      const row = result.rows[0];
      if (row === undefined) throw new NotFoundError('Organização', 'tenant_not_found');
      entry = {
        tenantId: row.tenant_id,
        slug: row.slug,
        status: row.status,
        expiresAt: now + CACHE_TTL_MS,
      };
      this.cache.set(ref, entry);
    }
    if (entry.status !== 'active')
      throw new ForbiddenError('Organização suspensa ou encerrada.', 'tenant_inactive');
    return { tenantId: entry.tenantId, slug: entry.slug, source };
  }
}
