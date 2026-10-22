import { describe, expect, it } from 'vitest';

import { computeWbsNumbers } from './wbs.js';

describe('computeWbsNumbers', () => {
  it('numera por grupo (ordem de position) e item (ordem de position)', () => {
    const groups = [
      { id: 'g2', position: 'b0' },
      { id: 'g1', position: 'a0' },
    ];
    const items = [
      { id: 'i2', groupId: 'g1', parentItemId: null, position: 'b0' },
      { id: 'i1', groupId: 'g1', parentItemId: null, position: 'a0' },
      { id: 'i3', groupId: 'g2', parentItemId: null, position: 'a0' },
    ];
    const numbers = computeWbsNumbers(groups, items);
    expect(numbers.get('i1')).toBe('1.1');
    expect(numbers.get('i2')).toBe('1.2');
    expect(numbers.get('i3')).toBe('2.1');
  });

  it('numera subitens recursivamente sob o pai', () => {
    const groups = [{ id: 'g1', position: 'a0' }];
    const items = [
      { id: 'parent', groupId: 'g1', parentItemId: null, position: 'a0' },
      { id: 'child2', groupId: 'g1', parentItemId: 'parent', position: 'b0' },
      { id: 'child1', groupId: 'g1', parentItemId: 'parent', position: 'a0' },
      { id: 'grandchild', groupId: 'g1', parentItemId: 'child1', position: 'a0' },
    ];
    const numbers = computeWbsNumbers(groups, items);
    expect(numbers.get('parent')).toBe('1.1');
    expect(numbers.get('child1')).toBe('1.1.1');
    expect(numbers.get('child2')).toBe('1.1.2');
    expect(numbers.get('grandchild')).toBe('1.1.1.1');
  });

  it('item de grupo desconhecido fica sem número', () => {
    const numbers = computeWbsNumbers([], [{ id: 'orphan', groupId: 'ghost', parentItemId: null, position: 'a0' }]);
    expect(numbers.has('orphan')).toBe(false);
  });
});
