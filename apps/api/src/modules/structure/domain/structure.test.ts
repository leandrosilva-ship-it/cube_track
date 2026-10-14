import { describe, expect, it } from 'vitest';

import {
  addDays,
  boardTemplate,
  createsCycle,
  normalizeLocale,
  positionAmong,
  weekStart,
} from './structure.js';

const siblings = [
  { id: 'a', position: 'a0' },
  { id: 'b', position: 'a1' },
  { id: 'c', position: 'a2' },
];

describe('positionAmong', () => {
  it('sem vizinhos vai para o fim', () => {
    expect(positionAmong(siblings, {}) > 'a2').toBe(true);
    expect(positionAmong([], {})).toBe('a0');
  });

  it('insere depois de um elemento (antes do seguinte)', () => {
    const position = positionAmong(siblings, { afterId: 'a' });
    expect(position > 'a0' && position < 'a1').toBe(true);
  });

  it('insere antes de um elemento', () => {
    expect(positionAmong(siblings, { beforeId: 'a' }) < 'a0').toBe(true);
    const position = positionAmong(siblings, { beforeId: 'c' });
    expect(position > 'a1' && position < 'a2').toBe(true);
  });

  it('insere entre dois vizinhos informados', () => {
    const position = positionAmong(siblings, { afterId: 'b', beforeId: 'c' });
    expect(position > 'a1' && position < 'a2').toBe(true);
  });
});

describe('createsCycle', () => {
  const folders = [
    { id: 'root', parentId: null },
    { id: 'child', parentId: 'root' },
    { id: 'grandchild', parentId: 'child' },
  ];

  it('detecta mover uma pasta para dentro de si mesma ou de uma descendente', () => {
    expect(createsCycle(folders, 'root', 'root')).toBe(true);
    expect(createsCycle(folders, 'root', 'grandchild')).toBe(true);
  });

  it('permite mover para a raiz ou para outro ramo', () => {
    expect(createsCycle(folders, 'grandchild', null)).toBe(false);
    expect(createsCycle(folders, 'grandchild', 'root')).toBe(false);
  });
});

describe('modelo de board', () => {
  it('usa o idioma do tenant e vincula o prazo ao término planejado', () => {
    const template = boardTemplate(normalizeLocale('pt-BR'));
    expect(template.columns.map((column) => column.title)).toEqual([
      'Status',
      'Responsável',
      'Prazo',
    ]);
    expect(template.columns.find((column) => column.key === 'c_due')?.binding).toBe(
      'item.planned_end_date',
    );
    expect(template.labels.filter((label) => label.isDefault)).toHaveLength(1);
    expect(boardTemplate(normalizeLocale('en-US')).view.name).toBe('Main table');
    expect(boardTemplate(normalizeLocale('es')).group.name).toBe('Nuevo grupo');
    expect(normalizeLocale(null)).toBe('pt-BR');
  });
});

describe('semana', () => {
  it('calcula a segunda-feira da semana ISO', () => {
    expect(weekStart('2026-10-14')).toBe('2026-10-12');
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
    expect(weekStart('2026-10-18')).toBe('2026-10-12');
    expect(addDays('2026-10-12', 6)).toBe('2026-10-18');
  });
});
