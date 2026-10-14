import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ShellDialog =
  | { type: 'newWorkspace' }
  | { type: 'newFolder'; workspaceId: string; parentId: string | null }
  | { type: 'newBoard'; workspaceId: string; folderId: string | null }
  | { type: 'rename'; workspaceId: string; node: 'board' | 'folder'; id: string; name: string }
  | { type: 'shortcuts' };

export interface ShellState {
  dialog: ShellDialog | null;
  paletteOpen: boolean;
  /** Painel do workspace aberto como drawer (telas pequenas). */
  mobilePanelOpen: boolean;
  /**
   * Paleta e diálogos são carregados sob demanda (fora do bundle inicial): ficam montados a partir
   * do primeiro uso para preservar animações de saída e estado.
   */
  overlaysRequested: boolean;
}

/** Estado efêmero de UI do shell (Zustand — ADR 0016). */
export const shellStore = createStore<ShellState>(() => ({
  dialog: null,
  paletteOpen: false,
  mobilePanelOpen: false,
  overlaysRequested: false,
}));

export function useShell<T>(selector: (state: ShellState) => T): T {
  return useStore(shellStore, selector);
}

export function openDialog(dialog: ShellDialog): void {
  shellStore.setState({ dialog, paletteOpen: false, overlaysRequested: true });
}

export function closeDialog(): void {
  shellStore.setState({ dialog: null });
}

export function setPaletteOpen(paletteOpen: boolean): void {
  shellStore.setState(paletteOpen ? { paletteOpen, overlaysRequested: true } : { paletteOpen });
}

export function setMobilePanelOpen(mobilePanelOpen: boolean): void {
  shellStore.setState({ mobilePanelOpen });
}
