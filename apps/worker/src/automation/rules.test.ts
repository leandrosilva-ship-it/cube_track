import { describe, expect, it } from 'vitest';

import {
  AutomationConfigError,
  evaluateConditions,
  localDate,
  parseActions,
  parseTrigger,
  renderMessage,
  resolveDynamicValue,
  scalarsOf,
  triggerMatches,
} from './rules.js';

const LABEL_DONE = '0190a000-0000-7000-8000-000000000001';
const LABEL_TODO = '0190a000-0000-7000-8000-000000000002';
const PERSON = '0190a000-0000-7000-8000-0000000000aa';

describe('scalarsOf', () => {
  it('extrai valores comparáveis de cada formato de célula', () => {
    expect(scalarsOf({ labelId: LABEL_DONE })).toEqual([LABEL_DONE]);
    expect(scalarsOf({ n: '12.50' })).toEqual([12.5]);
    expect(scalarsOf({ checked: true })).toEqual([true]);
    expect(scalarsOf({ d: '2026-03-02' })).toEqual(['2026-03-02']);
    expect(scalarsOf({ personIds: [PERSON], teamIds: [] })).toEqual([PERSON]);
    expect(scalarsOf(null)).toEqual([]);
    expect(scalarsOf('texto')).toEqual(['texto']);
  });
});

describe('triggerMatches', () => {
  const trigger = parseTrigger({
    type: 'column_value_changed',
    config: { columnKey: 'c_status', to: [LABEL_DONE] },
  });

  it('dispara quando a coluna muda para o valor-alvo', () => {
    expect(
      triggerMatches(trigger, {
        type: 'item.updated',
        changes: [{ field: 'c_status', value: { labelId: LABEL_DONE } }],
        groupId: null,
      }),
    ).toBe(true);
  });

  it('não dispara para outro valor, outra coluna ou outro evento', () => {
    expect(
      triggerMatches(trigger, {
        type: 'item.updated',
        changes: [{ field: 'c_status', value: { labelId: LABEL_TODO } }],
        groupId: null,
      }),
    ).toBe(false);
    expect(
      triggerMatches(trigger, {
        type: 'item.updated',
        changes: [{ field: 'name', value: 'x' }],
        groupId: null,
      }),
    ).toBe(false);
    expect(triggerMatches(trigger, { type: 'item.created', changes: [], groupId: null })).toBe(
      false,
    );
  });

  it('resolve toLabel por ids informados e aceita qualquer mudança sem alvo', () => {
    const byLabel = parseTrigger({
      type: 'column_value_changed',
      config: { columnKey: 'c_status', toLabel: 'Concluído' },
    });
    const event = {
      type: 'item.updated',
      changes: [{ field: 'c_status', value: { labelId: LABEL_DONE } }],
      groupId: null,
    };
    expect(triggerMatches(byLabel, event, [LABEL_DONE])).toBe(true);
    expect(triggerMatches(byLabel, event, [LABEL_TODO])).toBe(false);
    const any = parseTrigger({ type: 'column_value_changed', config: { columnKey: 'c_status' } });
    expect(triggerMatches(any, event)).toBe(true);
  });

  it('item_created respeita o grupo configurado', () => {
    const created = parseTrigger({
      type: 'item_created',
      config: { groupId: '0190a000-0000-7000-8000-0000000000bb' },
    });
    expect(
      triggerMatches(created, {
        type: 'item.created',
        changes: [],
        groupId: '0190a000-0000-7000-8000-0000000000bb',
      }),
    ).toBe(true);
    expect(
      triggerMatches(created, {
        type: 'item.created',
        changes: [],
        groupId: '0190a000-0000-7000-8000-0000000000cc',
      }),
    ).toBe(false);
  });

  it('rejeita gatilho desconhecido como erro de configuração', () => {
    expect(() => parseTrigger({ type: 'date_arrives', config: {} })).toThrow(AutomationConfigError);
  });
});

describe('evaluateConditions', () => {
  const fields = {
    c_status: { labelId: LABEL_TODO },
    c_ust: { n: '40' },
    name: 'Portal OGM',
    c_obs: { text: '' },
  };

  it('sem condições é sempre verdadeiro', () => {
    expect(evaluateConditions(null, fields)).toBe(true);
  });

  it('avalia operadores de conjunto, comparação, texto e vazio com grupos aninhados', () => {
    expect(
      evaluateConditions(
        {
          op: 'and',
          conditions: [{ columnKey: 'c_status', operator: 'none_of', value: [LABEL_DONE] }],
        },
        fields,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { op: 'and', conditions: [{ field: 'c_ust', operator: 'gte', value: 40 }] },
        fields,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { op: 'and', conditions: [{ field: 'c_ust', operator: 'gt', value: 40 }] },
        fields,
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        { op: 'and', conditions: [{ field: 'name', operator: 'contains', value: 'ogm' }] },
        fields,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { op: 'and', conditions: [{ field: 'c_obs', operator: 'is_empty' }] },
        fields,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        {
          op: 'or',
          conditions: [
            { field: 'c_status', operator: 'is', value: LABEL_DONE },
            {
              op: 'and',
              conditions: [
                { field: 'c_ust', operator: 'lt', value: 100 },
                { field: 'name', operator: 'is_not_empty' },
              ],
            },
          ],
        },
        fields,
      ),
    ).toBe(true);
  });

  it('condições malformadas geram erro de configuração', () => {
    expect(() => evaluateConditions({ op: 'xor', conditions: [] }, fields)).toThrow(
      AutomationConfigError,
    );
    expect(() =>
      evaluateConditions({ op: 'and', conditions: [{ operator: 'is', value: 1 }] }, fields),
    ).toThrow(AutomationConfigError);
  });
});

describe('ações e valores dinâmicos', () => {
  it('valida a lista de ações', () => {
    expect(parseActions([{ type: 'move_to_group', config: { groupId: LABEL_DONE } }])).toHaveLength(
      1,
    );
    expect(() => parseActions([])).toThrow(AutomationConfigError);
    expect(() => parseActions([{ type: 'delete_board', config: {} }])).toThrow(
      AutomationConfigError,
    );
  });

  it('resolve "hoje" no fuso do tenant', () => {
    const now = new Date('2026-03-03T01:30:00Z'); // 2 de março, 22h30 em São Paulo
    expect(localDate(now, 'America/Sao_Paulo')).toBe('2026-03-02');
    expect(resolveDynamicValue({ relative: 'today' }, now, 'America/Sao_Paulo')).toBe('2026-03-02');
    expect(resolveDynamicValue({ relative: 'today', offsetDays: 3 }, now, 'UTC')).toBe(
      '2026-03-06',
    );
    expect(resolveDynamicValue({ labelId: LABEL_DONE }, now, 'UTC')).toEqual({
      labelId: LABEL_DONE,
    });
  });

  it('renderiza mensagens com campos do item', () => {
    expect(
      renderMessage('O prazo de "{item.name}" vence; UST {item.c_ust}.', {
        name: 'Portal',
        c_ust: { n: '12' },
      }),
    ).toBe('O prazo de "Portal" vence; UST 12.');
  });
});
