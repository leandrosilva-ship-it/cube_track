import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearUndo, pushUndo, redo, undo, undoStore, UNDO_LIMIT } from './undo';

const BOARD = 'board-1';

afterEach(() => {
  clearUndo(BOARD);
});

describe('desfazer/refazer', () => {
  it('desfaz e refaz na ordem; nova ação limpa o "refazer"', async () => {
    const calls: string[] = [];
    const entry = (name: string) => ({
      label: name,
      undo: () => {
        calls.push(`undo ${name}`);
        return Promise.resolve();
      },
      redo: () => {
        calls.push(`redo ${name}`);
        return Promise.resolve();
      },
    });
    pushUndo(BOARD, entry('a'));
    pushUndo(BOARD, entry('b'));
    expect((await undo(BOARD))?.label).toBe('b');
    expect((await redo(BOARD))?.label).toBe('b');
    expect((await undo(BOARD))?.label).toBe('b');
    pushUndo(BOARD, entry('c'));
    expect(await redo(BOARD)).toBeNull();
    expect(calls).toEqual(['undo b', 'redo b', 'undo b']);
  });

  it('falha na operação inversa descarta a entrada e propaga o erro', async () => {
    pushUndo(BOARD, {
      label: 'x',
      undo: vi.fn(() => Promise.reject(new Error('gone'))),
      redo: vi.fn(() => Promise.resolve()),
    });
    await expect(undo(BOARD)).rejects.toThrow('gone');
    expect(undoStore.getState().past[BOARD]).toEqual([]);
    expect(undoStore.getState().busy).toBe(false);
  });

  it('limita o histórico', () => {
    for (let index = 0; index < UNDO_LIMIT + 5; index += 1)
      pushUndo(BOARD, {
        label: String(index),
        undo: () => Promise.resolve(),
        redo: () => Promise.resolve(),
      });
    expect(undoStore.getState().past[BOARD]).toHaveLength(UNDO_LIMIT);
    expect(undoStore.getState().past[BOARD]?.[0]?.label).toBe('5');
  });
});
