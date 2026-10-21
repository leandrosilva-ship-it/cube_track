import { describe, expect, it } from 'vitest';

import { docToPlainText, emptyDoc, extractMentions, isBlankDoc, mentionAttrs, textToDoc } from './richtext.js';

describe('richtext', () => {
  describe('extractMentions', () => {
    it('extrai menções de parágrafos aninhados sem duplicatas', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Oi ' },
              { type: 'mention', attrs: mentionAttrs.user('u1', 'Ana') },
              { type: 'text', text: ' e ' },
              { type: 'mention', attrs: mentionAttrs.team('t1', 'Dev') },
            ],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: mentionAttrs.user('u1', 'Ana') },
              { type: 'mention', attrs: mentionAttrs.everyone('todos') },
            ],
          },
        ],
      };
      expect(extractMentions(doc)).toEqual([
        { targetType: 'user', targetId: 'u1' },
        { targetType: 'team', targetId: 't1' },
        { targetType: 'everyone', targetId: null },
      ]);
    });

    it('documento sem menções retorna vazio', () => {
      expect(extractMentions(emptyDoc())).toEqual([]);
    });

    it('ignora entradas malformadas sem lançar', () => {
      expect(extractMentions(null)).toEqual([]);
      expect(extractMentions({ type: 'mention', attrs: { kind: 'user', id: 42 } })).toEqual([]);
      expect(extractMentions({ type: 'mention', attrs: { kind: 'bogus', id: 'u1' } })).toEqual([]);
    });
  });

  describe('docToPlainText', () => {
    it('junta parágrafos com quebra de linha e renderiza menções como @rótulo', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Primeira linha' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Olá ' },
              { type: 'mention', attrs: mentionAttrs.user('u1', 'Ana') },
            ],
          },
        ],
      };
      expect(docToPlainText(doc)).toBe('Primeira linha\nOlá @Ana');
    });

    it('trata quebras de linha manuais dentro do parágrafo', () => {
      const doc = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'linha 1' },
              { type: 'hardBreak' },
              { type: 'text', text: 'linha 2' },
            ],
          },
        ],
      };
      expect(docToPlainText(doc)).toBe('linha 1\nlinha 2');
    });

    it('documento vazio gera texto vazio', () => {
      expect(docToPlainText(emptyDoc())).toBe('');
      expect(isBlankDoc(emptyDoc())).toBe(true);
    });

    it('isBlankDoc é falso quando há texto', () => {
      const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
      expect(isBlankDoc(doc)).toBe(false);
    });
  });

  describe('textToDoc', () => {
    it('converte parágrafos (linha em branco) e quebras de linha simples em round-trip', () => {
      const doc = textToDoc('Primeiro parágrafo\nsegunda linha\n\nSegundo parágrafo');
      expect(docToPlainText(doc)).toBe('Primeiro parágrafo\nsegunda linha\nSegundo parágrafo');
    });

    it('texto vazio vira o documento vazio padrão', () => {
      expect(textToDoc('   ')).toEqual(emptyDoc());
    });
  });
});
