'use client';

import { EmptyState, Input, Skeleton } from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { FileText, LayoutGrid, MessageSquare, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api/client';
import type { SearchHit } from '@/lib/api/types';
import { qk } from '@/lib/query/keys';

import { useTree } from '../workspace/hooks';
import { useCurrentWorkspaceId } from '../workspace/use-current-workspace';

const GROUPS = [
  { type: 'items', icon: FileText },
  { type: 'boards', icon: LayoutGrid },
  { type: 'updates', icon: MessageSquare },
] as const;

/** Busca global (Meilisearch, filtrada por permissão no servidor); a consulta fica na URL. */
export function SearchPage() {
  const t = useTranslations('search');
  const router = useRouter();
  const initial = useSearchParams().get('q') ?? '';
  const [value, setValue] = useState(initial);
  const [query, setQuery] = useState(initial.trim());
  const workspaceId = useCurrentWorkspaceId();
  const tree = useTree(workspaceId);

  useEffect(() => {
    const handle = setTimeout(() => {
      const trimmed = value.trim();
      setQuery(trimmed);
      router.replace(trimmed === '' ? '/search' : `/search?q=${encodeURIComponent(trimmed)}`, {
        scroll: false,
      });
    }, 250);
    return () => {
      clearTimeout(handle);
    };
  }, [value, router]);

  const results = useQuery({
    queryKey: qk.search(query),
    queryFn: () =>
      api<{ data: SearchHit[] }>('/v1/search', { query: { q: query, limit: 20 } }).then(
        (response) => response.data,
      ),
    enabled: query.length >= 2,
  });
  const workspaceOf = (boardId: string) =>
    tree.data?.boards.find((board) => board.id === boardId)?.workspaceId ?? workspaceId ?? '';
  const boardName = (boardId: string) =>
    tree.data?.boards.find((board) => board.id === boardId)?.name;

  return (
    <div className="pb-10">
      <PageHeader title={t('title')} />
      <div className="flex flex-col gap-6 px-4 sm:px-8">
        <div className="relative max-w-2xl">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
            }}
            placeholder={t('placeholder')}
            aria-label={t('placeholder')}
            className="h-12 ps-11 text-base"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- página dedicada à busca
            autoFocus
          />
        </div>
        <div aria-live="polite" aria-busy={results.isFetching}>
          {query.length < 2 ? (
            <p className="text-sm text-fg-muted">{t('hint')}</p>
          ) : results.data === undefined ? (
            <Skeleton className="h-32" />
          ) : results.data.length === 0 ? (
            <EmptyState icon={<Search aria-hidden="true" />} title={t('empty', { query })} />
          ) : (
            <div className="flex flex-col gap-6">
              {GROUPS.map(({ type, icon: Icon }) => {
                const hits = results.data.filter((hit) => hit.type === type);
                if (hits.length === 0) return null;
                return (
                  <section key={type} aria-labelledby={`results-${type}`}>
                    <h2 id={`results-${type}`} className="mb-2 text-sm font-semibold text-fg-muted">
                      {t(type)}
                    </h2>
                    <ul className="flex flex-col gap-1">
                      {hits.map((hit) => (
                        <li key={`${type}-${hit.id}`}>
                          <Link
                            href={`/w/${workspaceOf(hit.boardId)}/b/${hit.boardId}`}
                            className="flex items-start gap-3 rounded-md px-3 py-2 hover:bg-surface-hover"
                          >
                            <Icon
                              className="mt-0.5 size-4 shrink-0 text-primary"
                              aria-hidden="true"
                            />
                            <span className="min-w-0">
                              <span className="block font-medium">{hit.title}</span>
                              {hit.snippet === null ? null : (
                                <span className="line-clamp-2 block text-sm text-fg-muted">
                                  {hit.snippet}
                                </span>
                              )}
                              {type !== 'boards' && boardName(hit.boardId) !== undefined ? (
                                <span className="block text-xs text-fg-subtle">
                                  {t('inBoard', { board: boardName(hit.boardId) ?? '' })}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
