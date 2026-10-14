import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type DensityPreference = 'comfortable' | 'compact';

export interface Preferences {
  theme: ThemePreference;
  density: DensityPreference;
  /** Painel do workspace recolhido (desktop). */
  panelCollapsed: boolean;
  /** Último workspace aberto (para restaurar a navegação). */
  lastWorkspaceId: string | null;
}

export const PREFERENCES_KEY = 'ct-prefs';

const defaults: Preferences = {
  theme: 'system',
  density: 'comfortable',
  panelCollapsed: false,
  lastWorkspaceId: null,
};

function load(): Preferences {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    return raw === null ? defaults : { ...defaults, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return defaults;
  }
}

export const preferencesStore = createStore<Preferences>(() => load());

/** Aplica tema e densidade no <html> (o script inline do layout faz o mesmo antes da pintura). */
export function applyPreferencesToDocument(preferences: Preferences): void {
  const root = document.documentElement;
  if (preferences.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preferences.theme);
  root.setAttribute('data-density', preferences.density);
}

export function updatePreferences(patch: Partial<Preferences>): void {
  preferencesStore.setState(patch);
  const next = preferencesStore.getState();
  try {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  } catch {
    // Armazenamento indisponível (modo privado): preferências valem só para a sessão.
  }
  applyPreferencesToDocument(next);
}

/** Tema efetivo (resolve "system" pela mídia do navegador). */
export function resolvedTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function usePreferences<T>(selector: (state: Preferences) => T): T {
  return useStore(preferencesStore, selector);
}

/**
 * Script executado antes da pintura (evita "flash" de tema). Mantido como string para ser
 * injetado no <head> pelo layout raiz.
 */
export const PREFERENCES_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem('${PREFERENCES_KEY}')||'{}');var r=document.documentElement;if(p.theme==='light'||p.theme==='dark'){r.setAttribute('data-theme',p.theme)}r.setAttribute('data-density',p.density==='compact'?'compact':'comfortable')}catch(e){}})();`;
