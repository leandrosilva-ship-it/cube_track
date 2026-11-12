import { describe, expect, it } from 'vitest';

import {
  BOARD_TEMPLATE_KEYS,
  boardTemplates,
  defaultStatusLabels,
  isBoardTemplateKey,
  type TemplateLocale,
} from './board-templates.js';

const LOCALES: TemplateLocale[] = ['pt-BR', 'en', 'es'];

describe('boardTemplates', () => {
  it.each(LOCALES)('gera os 4 templates embutidos no idioma %s, cada um válido', (locale) => {
    const templates = boardTemplates(locale);
    expect(templates.map((template) => template.key).sort()).toEqual(
      [...BOARD_TEMPLATE_KEYS].sort(),
    );
    for (const template of templates) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.groups.length).toBeGreaterThan(0);
      expect(template.columns.length).toBeGreaterThan(0);
      // A coluna de status principal precisa existir entre as colunas do próprio template.
      expect(template.columns.some((column) => column.key === template.statusColumnKey)).toBe(true);
      // Toda coluna referenciada por requiredWhenLabel precisa existir no template.
      for (const column of template.columns) {
        if (column.requiredWhenLabel === undefined) continue;
        const target = template.columns.find((c) => c.key === column.requiredWhenLabel?.columnKey);
        expect(target).toBeDefined();
        expect(target?.labels?.[column.requiredWhenLabel.labelIndex]).toBeDefined();
      }
    }
  });

  it('o template "service_orders" traz a coluna "OS emitida" com obrigatoriedade condicional do Processo SEI', () => {
    const template = boardTemplates('pt-BR').find((t) => t.key === 'service_orders');
    expect(template).toBeDefined();
    const seiColumn = template?.columns.find((column) => column.requiredWhenLabel !== undefined);
    expect(seiColumn).toBeDefined();
  });

  it('o conteúdo muda por idioma (nomes de grupo/coluna traduzidos)', () => {
    const pt = boardTemplates('pt-BR').find((t) => t.key === 'blank');
    const en = boardTemplates('en').find((t) => t.key === 'blank');
    expect(pt?.name).not.toBe(en?.name);
  });
});

describe('defaultStatusLabels', () => {
  it.each(LOCALES)('retorna as 4 categorias de status no idioma %s, nessa ordem', (locale) => {
    const labels = defaultStatusLabels(locale);
    expect(labels.map((label) => label.category)).toEqual([
      'not_started',
      'in_progress',
      'stuck',
      'done',
    ]);
    expect(labels.every((label) => label.label.length > 0 && label.color.startsWith('#'))).toBe(true);
  });

  it('os textos diferem entre pt-BR e en', () => {
    expect(defaultStatusLabels('pt-BR')[0]?.label).toBe('A fazer');
    expect(defaultStatusLabels('en')[0]?.label).toBe('To do');
  });
});

describe('isBoardTemplateKey', () => {
  it('aceita cada chave de template conhecida', () => {
    for (const key of BOARD_TEMPLATE_KEYS) expect(isBoardTemplateKey(key)).toBe(true);
  });

  it('recusa uma chave desconhecida', () => {
    expect(isBoardTemplateKey('nao-existe')).toBe(false);
    expect(isBoardTemplateKey('')).toBe(false);
  });
});
