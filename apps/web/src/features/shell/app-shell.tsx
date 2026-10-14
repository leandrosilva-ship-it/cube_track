'use client';

import { Drawer, Dialog, IconButton, Logo, Skeleton, cn } from '@cube-track/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Menu, PanelLeftOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { bootstrapSession, onAuthBroadcast, refreshSession } from '@/lib/auth/session';
import { RealtimeProvider } from '@/realtime/provider';
import { clearSession, useSession } from '@/stores/session';
import { setMobilePanelOpen, useShell } from '@/stores/shell';
import { updatePreferences, usePreferences } from '@/stores/preferences';

import { WorkspacePanel } from '../workspace/workspace-panel';
import { IconRail } from './icon-rail';
import { useGlobalShortcuts } from './shortcuts';
import { UserMenu } from './user-menu';

const loadPalette = () => import('./command-palette').then((module) => module.CommandPalette);
const loadDialogs = () => import('./shell-dialogs').then((module) => module.ShellDialogs);
const CommandPalette = dynamic(loadPalette, { ssr: false });
const ShellDialogs = dynamic(loadDialogs, { ssr: false });

/** Pré-carrega paleta e diálogos quando o navegador fica ocioso (abrem sem atraso perceptível). */
function usePrefetchOverlays() {
  useEffect(() => {
    const prefetch = () => {
      void loadPalette();
      void loadDialogs();
    };
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(prefetch, { timeout: 5_000 });
      return () => {
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(prefetch, 3_000);
    return () => {
      clearTimeout(timer);
    };
  }, []);
}

/** Mesmo arcabouço do shell (barra superior/inferior no mobile, trilho e painel no desktop): sem CLS. */
function ShellSkeleton() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row" aria-busy="true">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 md:hidden">
        <Skeleton className="size-9" />
        <Logo className="flex-1" />
        <Skeleton className="size-8 rounded-full" />
      </div>
      <div className="hidden w-14 shrink-0 border-e border-border bg-surface md:block" />
      <div className="hidden w-64 shrink-0 border-e border-border bg-surface p-3 lg:block">
        <Skeleton className="mb-3 h-8" />
        <Skeleton className="mb-2 h-6" />
        <Skeleton className="h-6 w-4/5" />
      </div>
      <div className="min-h-0 flex-1 p-6">
        <Skeleton className="mb-4 h-8 w-1/3" />
        <Skeleton className="h-40" />
      </div>
      <div className="h-[49px] shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" />
    </div>
  );
}

function AuthenticatedShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell.workspace');
  const tc = useTranslations('common');
  const collapsed = usePreferences((state) => state.panelCollapsed);
  const mobileOpen = useShell((state) => state.mobilePanelOpen);
  const overlaysRequested = useShell((state) => state.overlaysRequested);
  const pathname = usePathname();
  useGlobalShortcuts();
  usePrefetchOverlays();

  // Fecha o drawer ao navegar.
  useEffect(() => {
    setMobilePanelOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-2 focus:top-2"
      >
        {tc('skipToContent')}
      </a>

      {/* Mobile/tablet: barra superior com menu do workspace */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 md:hidden">
        <IconButton
          label={t('openMenu')}
          icon={<Menu aria-hidden="true" />}
          onClick={() => {
            setMobilePanelOpen(true);
          }}
        />
        <Logo className="flex-1" />
        <UserMenu side="bottom" />
      </header>

      <div className="hidden md:block">
        <IconRail />
      </div>

      <aside
        className={cn(
          'hidden w-64 shrink-0 border-e border-border bg-surface lg:block',
          collapsed && 'lg:hidden',
        )}
      >
        <WorkspacePanel collapsible />
      </aside>

      <Dialog open={mobileOpen} onOpenChange={setMobilePanelOpen}>
        <Drawer side="left" title={t('panel')} closeLabel={tc('close')} className="max-w-xs p-0">
          <WorkspacePanel
            onNavigate={() => {
              setMobilePanelOpen(false);
            }}
          />
        </Drawer>
      </Dialog>

      <main
        id="main"
        tabIndex={-1}
        className="relative min-h-0 min-w-0 flex-1 overflow-y-auto outline-none"
      >
        {collapsed ? (
          <div className="absolute start-2 top-2 z-10 hidden lg:block">
            <IconButton
              label={t('showPanel')}
              icon={<PanelLeftOpen aria-hidden="true" />}
              shortcut="["
              size="icon-sm"
              onClick={() => {
                updatePreferences({ panelCollapsed: false });
              }}
            />
          </div>
        ) : null}
        {children}
      </main>

      <div className="md:hidden">
        <IconRail orientation="horizontal" />
      </div>

      {overlaysRequested ? (
        <>
          <CommandPalette />
          <ShellDialogs />
        </>
      ) : null}
    </div>
  );
}

const noopSubscribe = () => () => undefined;

/** false no servidor e na hidratação; true logo após montar (estado do navegador disponível). */
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Shell autenticado: recupera a sessão pelo cookie (ou manda para o login com `next`), conecta o
 * realtime e mantém navegação persistente entre páginas (sem recarregar).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const status = useSession((state) => state.status);
  const mounted = useMounted();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  useEffect(() => {
    void bootstrapSession();
  }, []);

  useEffect(() => {
    if (status === 'anonymous') {
      queryClient.clear();
      router.replace(`/login?next=${encodeURIComponent(`${pathname}${window.location.search}`)}`);
    }
  }, [status, router, pathname, queryClient]);

  // Outras abas: logout encerra esta; login/troca de organização renova a sessão aqui.
  useEffect(
    () =>
      onAuthBroadcast((message) => {
        if (message.type === 'signed-out') {
          clearSession();
          return;
        }
        queryClient.clear();
        void refreshSession();
      }),
    [queryClient],
  );

  // Logo após montar, shell e página renderizam em paralelo à recuperação da sessão (as queries só
  // disparam autenticadas): o conteúdo aparece sem esperar o refresh terminar.
  if (!mounted || status === 'anonymous') return <ShellSkeleton />;
  return (
    <RealtimeProvider>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </RealtimeProvider>
  );
}
