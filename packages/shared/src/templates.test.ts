import { describe, expect, it } from 'vitest';

import { parseTemplatePayload, TemplateConfigError } from './templates.js';

describe('parseTemplatePayload — board', () => {
  const valid = {
    name: 'Projeto',
    description: '',
    icon: 'briefcase',
    groups: [{ name: 'Planejamento', color: '#579bfc' }],
    columns: [{ key: 'c_status', type: 'status', title: 'Status' }],
    statusColumnKey: 'c_status',
  };

  it('aceita um payload de board válido e aplica os defaults', () => {
    const parsed = parseTemplatePayload('board', valid);
    expect(parsed.viewName).toBe('Tabela principal');
  });

  it('recusa quando falta um campo obrigatório', () => {
    expect(() => parseTemplatePayload('board', { ...valid, statusColumnKey: undefined })).toThrow(TemplateConfigError);
  });
});

describe('parseTemplatePayload — automation', () => {
  it('reaproveita parseTrigger/parseActions e recusa um gatilho inválido', () => {
    const valid = {
      name: 'Notificar ao criar',
      description: null,
      trigger: { type: 'item_created', config: {} },
      actions: [{ type: 'notify', config: { message: 'Novo item!' } }],
    };
    const parsed = parseTemplatePayload('automation', valid);
    expect(parsed.trigger.type).toBe('item_created');
    expect(() => parseTemplatePayload('automation', { ...valid, trigger: { type: 'not_a_trigger' } })).toThrow(TemplateConfigError);
  });
});

describe('parseTemplatePayload — dashboard', () => {
  it('valida cada widget conforme seu type (reaproveita parseWidgetConfig)', () => {
    const valid = {
      name: 'Visão geral',
      widgets: [{ type: 'project_health', title: 'Saúde', config: { boardId: '00000000-0000-7000-8000-000000000000' }, layout: { x: 0, y: 0, w: 4, h: 4 } }],
    };
    expect(() => parseTemplatePayload('dashboard', valid)).not.toThrow();
    expect(() => parseTemplatePayload('dashboard', { ...valid, widgets: [{ ...valid.widgets[0], config: { boardId: 'não-é-uuid' } }] })).toThrow(TemplateConfigError);
  });
});

describe('parseTemplatePayload — form', () => {
  it('valida os campos nativos e recusa um fieldType desconhecido', () => {
    const valid = { name: 'Formulário', description: '', fields: [{ fieldType: 'text', label: 'Nome', isRequired: true }] };
    expect(() => parseTemplatePayload('form', valid)).not.toThrow();
    expect(() => parseTemplatePayload('form', { ...valid, fields: [{ fieldType: 'not_a_type', label: 'X' }] })).toThrow(TemplateConfigError);
  });
});

describe('parseTemplatePayload — workspace', () => {
  it('valida uma lista de boards aninhados', () => {
    const board = {
      name: 'Projeto',
      description: '',
      icon: 'briefcase',
      groups: [{ name: 'Planejamento', color: '#579bfc' }],
      columns: [{ key: 'c_status', type: 'status', title: 'Status' }],
      statusColumnKey: 'c_status',
      viewName: 'Tabela principal',
    };
    const parsed = parseTemplatePayload('workspace', { boards: [{ name: 'Projetos', blueprint: board }] });
    expect(parsed.boards).toHaveLength(1);
  });
});
