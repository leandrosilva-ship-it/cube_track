'use client';

import { Badge, Skeleton } from '@cube-track/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { FormMessage } from '@/components/common/form-error';
import { useRouter } from '@/i18n/navigation';
import { bootstrapSession, establishSession } from '@/lib/auth/session';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { qk } from '@/lib/query/keys';
import { useSession } from '@/stores/session';

import { authApi } from '../api';
import { safeNextPath } from '../next-path';

/** Seleção de organização (usuário em mais de um tenant). */
export function OrganizationPicker() {
  const t = useTranslations('auth.organizations');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const next = safeNextPath(useSearchParams().get('next'));
  const status = useSession((state) => state.status);
  const currentTenantId = useSession((state) => state.tenant?.id ?? null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bootstrapSession().then((ok) => {
      if (!ok) router.replace(`/login?next=${encodeURIComponent('/organizations')}`);
    });
  }, [router]);

  const organizations = useQuery({
    queryKey: qk.organizations(),
    queryFn: authApi.organizations,
    enabled: status === 'authenticated',
  });

  const choose = async (tenantId: string) => {
    if (tenantId === currentTenantId) {
      router.replace(next);
      return;
    }
    setSwitching(tenantId);
    setError(null);
    try {
      const session = await authApi.switchOrganization(tenantId);
      queryClient.clear();
      establishSession(session);
      router.replace(next);
    } catch (caught) {
      setError(errorMessage(caught));
      setSwitching(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t('description')}</p>
      </div>
      <FormMessage>{error}</FormMessage>
      {organizations.data === undefined ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {organizations.data.data.map((organization) => (
            <li key={organization.tenantId}>
              <button
                type="button"
                disabled={switching !== null}
                aria-busy={switching === organization.tenantId}
                onClick={() => void choose(organization.tenantId)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-3 text-start hover:bg-surface-hover disabled:opacity-60"
              >
                <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary">
                  <Building2 className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{organization.tenantName}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {organization.tenantSlug}
                  </span>
                </span>
                {organization.tenantId === currentTenantId ? (
                  <Badge tone="primary">{t('current')}</Badge>
                ) : null}
                {organization.kind === 'guest' ? <Badge tone="info">{t('guest')}</Badge> : null}
                <ChevronRight className="size-4 text-fg-muted" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {switching === null ? null : (
        <p className="text-sm text-fg-muted" aria-live="polite">
          {t('switching')}
        </p>
      )}
    </div>
  );
}
