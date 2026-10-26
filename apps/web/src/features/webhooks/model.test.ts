import { describe, expect, it } from 'vitest';

import { headersToRows, rowsToHeaders, WEBHOOK_EVENT_TYPES } from './model';

describe('headersToRows / rowsToHeaders', () => {
  it('converte um mapa de cabeçalhos em linhas editáveis e de volta', () => {
    const headers = { 'X-Source': 'cube-track', Authorization: 'Bearer abc' };
    const rows = headersToRows(headers);
    expect(rows).toEqual([
      { key: 'X-Source', value: 'cube-track' },
      { key: 'Authorization', value: 'Bearer abc' },
    ]);
    expect(rowsToHeaders(rows)).toEqual(headers);
  });

  it('descarta linhas com chave vazia ou só espaços ao converter de volta', () => {
    const rows = [
      { key: '  ', value: 'ignorado' },
      { key: 'X-Valid', value: 'mantido' },
      { key: '', value: 'ignorado também' },
    ];
    expect(rowsToHeaders(rows)).toEqual({ 'X-Valid': 'mantido' });
  });

  it('mapa vazio vira lista vazia', () => {
    expect(headersToRows({})).toEqual([]);
    expect(rowsToHeaders([])).toEqual({});
  });
});

describe('WEBHOOK_EVENT_TYPES', () => {
  it('não repete nenhum tipo de evento', () => {
    expect(new Set(WEBHOOK_EVENT_TYPES).size).toBe(WEBHOOK_EVENT_TYPES.length);
  });

  it('não inclui eventos de infraestrutura interna irrelevantes para assinantes externos', () => {
    const internal = ['presence.joined', 'presence.left', 'session.revoked', 'favorites.changed'];
    for (const type of internal) {
      expect(WEBHOOK_EVENT_TYPES).not.toContain(type);
    }
  });
});
