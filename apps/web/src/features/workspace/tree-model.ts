import { positionBetween } from '@cube-track/shared';

import type { TreeBoard, TreeFolder, WorkspaceTree } from '@/lib/api/types';

export type TreeRow =
  | {
      kind: 'folder';
      id: string;
      depth: number;
      folder: TreeFolder;
      expanded: boolean;
      childCount: number;
    }
  | { kind: 'board'; id: string; depth: number; board: TreeBoard };

const byPosition = <T extends { position: string }>(a: T, b: T) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/**
 * Achata a árvore (pastas primeiro, depois boards, ambos por posição) nas linhas visíveis,
 * respeitando pastas recolhidas e o filtro por nome (com filtro, tudo aparece expandido).
 */
export function flattenTree(
  tree: WorkspaceTree,
  collapsed: ReadonlySet<string>,
  filter = '',
): TreeRow[] {
  const query = filter.trim().toLocaleLowerCase('pt-BR');
  const folders = [...tree.folders].sort(byPosition);
  const boards = [...tree.boards].sort(byPosition);
  const matches = (name: string) => query === '' || name.toLocaleLowerCase('pt-BR').includes(query);

  const hasMatch = (folderId: string): boolean =>
    boards.some((board) => board.folderId === folderId && matches(board.name)) ||
    folders.some(
      (folder) => folder.parentId === folderId && (matches(folder.name) || hasMatch(folder.id)),
    );

  const rows: TreeRow[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of folders.filter((entry) => entry.parentId === parentId)) {
      if (query !== '' && !matches(folder.name) && !hasMatch(folder.id)) continue;
      const expanded = query !== '' || !collapsed.has(folder.id);
      const childCount =
        folders.filter((entry) => entry.parentId === folder.id).length +
        boards.filter((entry) => entry.folderId === folder.id).length;
      rows.push({ kind: 'folder', id: folder.id, depth, folder, expanded, childCount });
      if (expanded) visit(folder.id, depth + 1);
    }
    for (const board of boards.filter((entry) => entry.folderId === parentId)) {
      if (!matches(board.name)) continue;
      rows.push({ kind: 'board', id: board.id, depth, board });
    }
  };
  visit(null, 0);
  return rows;
}

/** Pasta descendente (ou ela mesma) — mover para dentro criaria ciclo. */
export function isDescendant(
  tree: WorkspaceTree,
  folderId: string,
  candidate: string | null,
): boolean {
  const parents = new Map(tree.folders.map((folder) => [folder.id, folder.parentId]));
  for (let current = candidate; current !== null; current = parents.get(current) ?? null) {
    if (current === folderId) return true;
  }
  return false;
}

export type MoveIntent =
  | { type: 'board'; id: string; folderId: string | null; beforeId?: string }
  | { type: 'folder'; id: string; parentId: string | null };

/**
 * Regra de soltar (arrastar com mouse ou teclado):
 * - board sobre pasta → entra na pasta (no fim);
 * - board sobre board → fica antes dele, na pasta dele;
 * - pasta sobre pasta → vira subpasta (se não criar ciclo);
 * - pasta sobre board → vai para a pasta daquele board.
 */
export function resolveDrop(
  tree: WorkspaceTree,
  active: TreeRow,
  over: TreeRow,
): MoveIntent | null {
  if (active.id === over.id) return null;
  if (active.kind === 'board') {
    if (over.kind === 'folder') return { type: 'board', id: active.id, folderId: over.id };
    return { type: 'board', id: active.id, folderId: over.board.folderId, beforeId: over.id };
  }
  const parentId = over.kind === 'folder' ? over.id : over.board.folderId;
  if (parentId === active.folder.parentId && over.kind === 'board') return null;
  if (isDescendant(tree, active.id, parentId)) return null;
  return { type: 'folder', id: active.id, parentId };
}

/** Aplica a movimentação localmente (update otimista; o servidor confirma a posição). */
export function applyMove(tree: WorkspaceTree, intent: MoveIntent): WorkspaceTree {
  if (intent.type === 'folder') {
    const siblings = tree.folders
      .filter((folder) => folder.parentId === intent.parentId && folder.id !== intent.id)
      .sort(byPosition);
    const position = positionBetween(siblings.at(-1)?.position ?? null, null);
    return {
      ...tree,
      folders: tree.folders.map((folder) =>
        folder.id === intent.id ? { ...folder, parentId: intent.parentId, position } : folder,
      ),
    };
  }
  const siblings = tree.boards
    .filter((board) => board.folderId === intent.folderId && board.id !== intent.id)
    .sort(byPosition);
  const beforeIndex =
    intent.beforeId === undefined
      ? -1
      : siblings.findIndex((board) => board.id === intent.beforeId);
  const before = beforeIndex === -1 ? undefined : siblings[beforeIndex];
  const previous = before === undefined ? siblings.at(-1) : siblings[beforeIndex - 1];
  const position = positionBetween(previous?.position ?? null, before?.position ?? null);
  return {
    ...tree,
    boards: tree.boards.map((board) =>
      board.id === intent.id ? { ...board, folderId: intent.folderId, position } : board,
    ),
  };
}
