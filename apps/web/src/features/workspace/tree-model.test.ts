import { describe, expect, it } from 'vitest';

import type { WorkspaceTree } from '@/lib/api/types';

import { applyMove, flattenTree, isDescendant, resolveDrop, type TreeRow } from './tree-model';

const board = (id: string, folderId: string | null, position: string, name = id) => ({
  id,
  workspaceId: 'w',
  folderId,
  kind: 'board' as const,
  name,
  description: null,
  visibility: 'main' as const,
  position,
});

const tree: WorkspaceTree = {
  workspaceId: 'w',
  canManageFolders: true,
  canCreateBoards: true,
  canManageResources: false,
  canApproveTimesheet: false,
  canManagePortfolio: false,
  canReadPortfolio: false,
  folders: [
    { id: 'f1', parentId: null, name: 'Clientes', color: null, position: 'a1' },
    { id: 'f2', parentId: 'f1', name: 'Prefeitura', color: null, position: 'a0' },
    { id: 'f3', parentId: null, name: 'Interno', color: null, position: 'a0' },
  ],
  boards: [
    board('b1', 'f2', 'a0', 'PMSP'),
    board('b2', null, 'a1', 'Melhorias'),
    board('b3', null, 'a0', 'Triagem'),
    board('b4', 'f3', 'a0', 'RH'),
  ],
};

const row = (rows: TreeRow[], id: string) => {
  const found = rows.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe('tree-model', () => {
  it('achata pastas antes de boards, por posição, com profundidade', () => {
    const rows = flattenTree(tree, new Set());
    expect(rows.map((entry) => `${entry.id}:${String(entry.depth)}`)).toEqual([
      'f3:0',
      'b4:1',
      'f1:0',
      'f2:1',
      'b1:2',
      'b3:0',
      'b2:0',
    ]);
    expect(row(rows, 'f1')).toMatchObject({ childCount: 1, expanded: true });
  });

  it('pastas recolhidas escondem descendentes; filtro mostra caminho até o resultado', () => {
    expect(flattenTree(tree, new Set(['f1'])).map((entry) => entry.id)).not.toContain('b1');
    expect(flattenTree(tree, new Set(['f1']), 'pmsp').map((entry) => entry.id)).toEqual([
      'f1',
      'f2',
      'b1',
    ]);
  });

  it('isDescendant detecta ciclos', () => {
    expect(isDescendant(tree, 'f1', 'f2')).toBe(true);
    expect(isDescendant(tree, 'f2', 'f1')).toBe(false);
    expect(isDescendant(tree, 'f1', null)).toBe(false);
  });

  it('resolveDrop segue as regras de soltar e recusa ciclos', () => {
    const rows = flattenTree(tree, new Set());
    expect(resolveDrop(tree, row(rows, 'b2'), row(rows, 'f3'))).toEqual({
      type: 'board',
      id: 'b2',
      folderId: 'f3',
    });
    expect(resolveDrop(tree, row(rows, 'b2'), row(rows, 'b1'))).toEqual({
      type: 'board',
      id: 'b2',
      folderId: 'f2',
      beforeId: 'b1',
    });
    expect(resolveDrop(tree, row(rows, 'f1'), row(rows, 'f2'))).toBeNull();
    expect(resolveDrop(tree, row(rows, 'f3'), row(rows, 'f1'))).toEqual({
      type: 'folder',
      id: 'f3',
      parentId: 'f1',
    });
    expect(resolveDrop(tree, row(rows, 'b1'), row(rows, 'b1'))).toBeNull();
  });

  it('applyMove calcula posição entre vizinhos (antes do alvo) ou no fim', () => {
    const before = applyMove(tree, { type: 'board', id: 'b2', folderId: null, beforeId: 'b3' });
    const moved = before.boards.find((entry) => entry.id === 'b2');
    expect(moved?.position !== undefined && moved.position < 'a0').toBe(true);

    const end = applyMove(tree, { type: 'board', id: 'b3', folderId: 'f3' });
    const last = end.boards.find((entry) => entry.id === 'b3');
    expect(last?.folderId).toBe('f3');
    expect(last?.position !== undefined && last.position > 'a0').toBe(true);

    const folder = applyMove(tree, { type: 'folder', id: 'f3', parentId: 'f1' });
    expect(folder.folders.find((entry) => entry.id === 'f3')).toMatchObject({ parentId: 'f1' });
  });
});
