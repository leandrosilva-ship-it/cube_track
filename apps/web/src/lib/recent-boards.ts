/** Boards visitados recentemente (por navegador; sem dados sensíveis além de nome e id). */
export interface RecentBoard {
  id: string;
  name: string;
  workspaceId: string;
  visitedAt: number;
}

const KEY = 'ct-recent-boards';
const LIMIT = 8;

export function readRecentBoards(): RecentBoard[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? [] : (JSON.parse(raw) as RecentBoard[]);
  } catch {
    return [];
  }
}

export function rememberBoard(board: Omit<RecentBoard, 'visitedAt'>): void {
  try {
    const next = [
      { ...board, visitedAt: Date.now() },
      ...readRecentBoards().filter((entry) => entry.id !== board.id),
    ].slice(0, LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Armazenamento indisponível: sem histórico.
  }
}

/** Remove o histórico (ao sair: outro usuário pode usar o navegador). */
export function clearRecentBoards(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nada a limpar.
  }
}
