import { describe, expect, it } from 'vitest';

import {
  centsToUnits,
  delayRiskTone,
  isRunRevertible,
  runStatusTone,
  similarityPercent,
  toggleAllowedAction,
  unitsToCents,
} from './model';

describe('centsToUnits / unitsToCents', () => {
  it('converte centavos para unidades e volta', () => {
    expect(centsToUnits(150000)).toBe('1500.00');
    expect(centsToUnits(null)).toBe('');
    expect(unitsToCents('1500')).toBe(150000);
    expect(unitsToCents('1500.50')).toBe(150050);
    expect(unitsToCents('1500,50')).toBe(150050);
    expect(unitsToCents('')).toBeNull();
    expect(unitsToCents('   ')).toBeNull();
    expect(unitsToCents('abc')).toBeNull();
  });

  it('é a inversa uma da outra para valores exatos em centavos', () => {
    const cents = 250099;
    expect(unitsToCents(centsToUnits(cents))).toBe(cents);
  });
});

describe('toggleAllowedAction', () => {
  it('adiciona, remove e respeita o limite máximo', () => {
    expect(toggleAllowedAction([], 'notify')).toEqual(['notify']);
    expect(toggleAllowedAction(['notify'], 'notify')).toEqual([]);
    expect(toggleAllowedAction(['notify', 'move_to_group'], 'set_column_value')).toEqual([
      'notify',
      'move_to_group',
      'set_column_value',
    ]);
    expect(
      toggleAllowedAction(['notify', 'move_to_group', 'set_column_value'], 'notify'),
    ).toEqual(['move_to_group', 'set_column_value']);
  });

  it('não ultrapassa o máximo (padrão 3)', () => {
    const atMax: ['notify', 'move_to_group', 'set_column_value'] = ['notify', 'move_to_group', 'set_column_value'];
    // já tem os 3 únicos tipos existentes, então não há um quarto para testar o bloqueio genérico —
    // valida com um máximo customizado menor.
    expect(toggleAllowedAction(['notify'], 'move_to_group', 1)).toEqual(['notify']);
    expect(toggleAllowedAction(atMax, 'notify')).toEqual(['move_to_group', 'set_column_value']);
  });
});

describe('runStatusTone', () => {
  it('mapeia cada status a um tom', () => {
    expect(runStatusTone('pending_approval')).toBe('warning');
    expect(runStatusTone('approved')).toBe('info');
    expect(runStatusTone('rejected')).toBe('danger');
    expect(runStatusTone('executed')).toBe('success');
    expect(runStatusTone('failed')).toBe('danger');
    expect(runStatusTone('reverted')).toBe('neutral');
  });
});

describe('isRunRevertible', () => {
  it('só executado + tipo revertível (set_column_value/move_to_group)', () => {
    expect(isRunRevertible({ status: 'executed', proposedAction: { type: 'set_column_value' } })).toBe(true);
    expect(isRunRevertible({ status: 'executed', proposedAction: { type: 'move_to_group' } })).toBe(true);
    expect(isRunRevertible({ status: 'executed', proposedAction: { type: 'notify' } })).toBe(false);
    expect(isRunRevertible({ status: 'pending_approval', proposedAction: { type: 'set_column_value' } })).toBe(
      false,
    );
    expect(isRunRevertible({ status: 'reverted', proposedAction: { type: 'set_column_value' } })).toBe(false);
  });
});

describe('delayRiskTone / similarityPercent', () => {
  it('delayRiskTone', () => {
    expect(delayRiskTone('overdue')).toBe('danger');
    expect(delayRiskTone('due_soon')).toBe('warning');
  });

  it('similarityPercent arredonda para porcentagem inteira', () => {
    expect(similarityPercent(0.6)).toBe(60);
    expect(similarityPercent(0.666)).toBe(67);
    expect(similarityPercent(1)).toBe(100);
  });
});
