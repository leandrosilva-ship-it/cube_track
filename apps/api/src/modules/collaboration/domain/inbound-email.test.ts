import { describe, expect, it } from 'vitest';

import { stripQuotedReply } from './inbound-email.js';

describe('stripQuotedReply', () => {
  it('mantém o texto quando não há citação', () => {
    expect(stripQuotedReply('Olá,\n\nisso resolve o problema.')).toBe('Olá,\n\nisso resolve o problema.');
  });

  it('corta em "On ... wrote:"', () => {
    const raw = 'Pode fechar o item.\n\nOn Mon, Jan 1, 2026, Ana wrote:\n> mensagem original';
    expect(stripQuotedReply(raw)).toBe('Pode fechar o item.');
  });

  it('corta em "Em ... escreveu:" (pt-BR)', () => {
    const raw = 'Já ajustei.\n\nEm seg., 1 de jan. de 2026, Ana escreveu:\n> texto antigo';
    expect(stripQuotedReply(raw)).toBe('Já ajustei.');
  });

  it('corta em linhas citadas com ">"', () => {
    const raw = 'Confirmado.\n> linha citada\n> outra linha';
    expect(stripQuotedReply(raw)).toBe('Confirmado.');
  });

  it('corta em "-----Original Message-----"', () => {
    const raw = 'Segue retorno.\n-----Original Message-----\nDe: ana@empresa.com';
    expect(stripQuotedReply(raw)).toBe('Segue retorno.');
  });

  it('aparar espaços nas extremidades', () => {
    expect(stripQuotedReply('\n\n  texto  \n\n')).toBe('texto');
  });
});
