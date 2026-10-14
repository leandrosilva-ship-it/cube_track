import type { ReactNode } from 'react';

/** Cabeçalho padrão de página (título h1, subtítulo e ações). */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-4 pt-6 pb-4 sm:px-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle === undefined ? null : <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {actions === undefined ? null : <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
