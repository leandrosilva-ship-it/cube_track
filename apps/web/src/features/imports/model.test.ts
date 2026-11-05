import { describe, expect, it } from 'vitest';

import { hasNameMapping, selectValueToTarget, targetToSelectValue } from './model';

describe('targetToSelectValue / selectValueToTarget', () => {
  it('ida e volta para cada tipo de alvo', () => {
    expect(targetToSelectValue({ type: 'ignore' })).toBe('ignore');
    expect(targetToSelectValue({ type: 'name' })).toBe('name');
    expect(targetToSelectValue({ type: 'group' })).toBe('group');
    expect(targetToSelectValue({ type: 'column', key: 'c_status' })).toBe('column:c_status');

    expect(selectValueToTarget('ignore')).toEqual({ type: 'ignore' });
    expect(selectValueToTarget('name')).toEqual({ type: 'name' });
    expect(selectValueToTarget('group')).toEqual({ type: 'group' });
    expect(selectValueToTarget('column:c_status')).toEqual({ type: 'column', key: 'c_status' });
  });

  it('um valor desconhecido vira "ignore"', () => {
    expect(selectValueToTarget('qualquer-coisa')).toEqual({ type: 'ignore' });
  });
});

describe('hasNameMapping', () => {
  it('verdadeiro só quando alguma coluna mapeia para o nome do item', () => {
    expect(hasNameMapping({})).toBe(false);
    expect(hasNameMapping({ '0': { type: 'ignore' }, '1': { type: 'group' } })).toBe(false);
    expect(hasNameMapping({ '0': { type: 'name' }, '1': { type: 'group' } })).toBe(true);
  });
});
