import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';

/** Mensagem de erro/sucesso de formulário, anunciada por leitores de tela. */
export function FormMessage({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'success';
  children: ReactNode;
}) {
  if (children === null || children === undefined || children === '') return null;
  const isError = tone === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={
        isError
          ? 'flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger'
          : 'flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success'
      }
    >
      {isError ? (
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      )}
      <span>{children}</span>
    </div>
  );
}
