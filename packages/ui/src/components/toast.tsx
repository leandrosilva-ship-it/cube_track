'use client';

import { Toaster as SonnerToaster, toast } from 'sonner';

export { toast };

export interface ToasterProps {
  theme?: 'light' | 'dark' | 'system';
  /** Rótulo da região de notificações (anunciada por leitores de tela). */
  label: string;
  closeLabel: string;
}

/** Região de toasts (aria-live) — sucesso, erro, desfazer. */
export function Toaster({ theme = 'system', label, closeLabel }: ToasterProps) {
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      closeButton
      containerAriaLabel={label}
      toastOptions={{
        closeButtonAriaLabel: closeLabel,
        classNames: {
          toast:
            'rounded-lg border border-border bg-surface-raised text-fg shadow-lg text-sm font-sans',
          description: 'text-fg-muted',
          actionButton: 'bg-primary text-primary-foreground',
          error: 'text-danger',
          success: 'text-success',
        },
      }}
    />
  );
}
