'use client';

import { useEffect } from 'react';

import { useRouter } from '@/i18n/navigation';
import { openDialog, setPaletteOpen, shellStore } from '@/stores/shell';
import { preferencesStore, updatePreferences } from '@/stores/preferences';

type ShortcutLabel =
  | 'palette'
  | 'help'
  | 'goHome'
  | 'goWeek'
  | 'goInbox'
  | 'goFavorites'
  | 'goSearch'
  | 'togglePanel'
  | 'newItem'
  | 'focusSearch';

export interface ShortcutDefinition {
  id: string;
  group: 'global' | 'navigation' | 'board';
  label: ShortcutLabel;
  keys: string[];
  /** Teclas pressionadas em sequência (ex.: g depois h). */
  sequence?: boolean;
}

/** Atalhos documentados (também em docs/frontend-guidelines.md). */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { id: 'palette', group: 'global', label: 'palette', keys: ['Ctrl/⌘', 'K'] },
  { id: 'help', group: 'global', label: 'help', keys: ['?'] },
  { id: 'panel', group: 'global', label: 'togglePanel', keys: ['['] },
  { id: 'home', group: 'navigation', label: 'goHome', keys: ['G', 'H'], sequence: true },
  { id: 'week', group: 'navigation', label: 'goWeek', keys: ['G', 'W'], sequence: true },
  { id: 'inbox', group: 'navigation', label: 'goInbox', keys: ['G', 'I'], sequence: true },
  { id: 'favorites', group: 'navigation', label: 'goFavorites', keys: ['G', 'F'], sequence: true },
  { id: 'search', group: 'navigation', label: 'goSearch', keys: ['G', 'S'], sequence: true },
  { id: 'new-item', group: 'board', label: 'newItem', keys: ['N'] },
  { id: 'board-search', group: 'board', label: 'focusSearch', keys: ['/'] },
];

export type BoardShortcut = 'newItem' | 'focusSearch';
export const BOARD_SHORTCUT_EVENT = 'ct:board-shortcut';

const SEQUENCES: Record<string, string> = {
  h: '/',
  w: '/my-week',
  i: '/inbox',
  f: '/favorites',
  s: '/search',
};

/** O usuário está digitando? (atalhos de uma tecla não podem roubar o texto) */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Atalhos globais do app autenticado. */
export function useGlobalShortcuts(): void {
  const router = useRouter();
  useEffect(() => {
    let pendingG = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!shellStore.getState().paletteOpen);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return;
      if (shellStore.getState().dialog !== null || shellStore.getState().paletteOpen) return;
      const key = event.key.toLowerCase();
      if (pendingG > Date.now()) {
        pendingG = 0;
        const destination = SEQUENCES[key];
        if (destination !== undefined) {
          event.preventDefault();
          router.push(destination);
        }
        return;
      }
      if (key === 'g') {
        pendingG = Date.now() + 1_000;
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        openDialog({ type: 'shortcuts' });
        return;
      }
      if (event.key === '[') {
        event.preventDefault();
        updatePreferences({ panelCollapsed: !preferencesStore.getState().panelCollapsed });
        return;
      }
      if (key === 'n' || event.key === '/') {
        const detail: BoardShortcut = key === 'n' ? 'newItem' : 'focusSearch';
        const handled = !window.dispatchEvent(
          new CustomEvent(BOARD_SHORTCUT_EVENT, { detail, cancelable: true }),
        );
        if (handled) event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [router]);
}

/** Registra um handler de atalhos do board (n, /) enquanto o board estiver aberto. */
export function useBoardShortcuts(handler: (shortcut: BoardShortcut) => void): void {
  useEffect(() => {
    const listener = (event: Event) => {
      event.preventDefault();
      handler((event as CustomEvent<BoardShortcut>).detail);
    };
    window.addEventListener(BOARD_SHORTCUT_EVENT, listener);
    return () => {
      window.removeEventListener(BOARD_SHORTCUT_EVENT, listener);
    };
  }, [handler]);
}
