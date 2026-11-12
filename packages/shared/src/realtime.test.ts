import { describe, expect, it } from 'vitest';

import { PRESENCE_HEARTBEAT_SECONDS, PRESENCE_TTL_SECONDS, REALTIME_CHANNEL, rooms } from './realtime.js';

describe('rooms', () => {
  const tenantId = 't1';

  it('tenant: prefixo "t:"', () => {
    expect(rooms.tenant(tenantId)).toBe('t:t1');
  });

  it('user: prefixo "t:<tenant>:u:"', () => {
    expect(rooms.user(tenantId, 'u1')).toBe('t:t1:u:u1');
  });

  it('board: prefixo "t:<tenant>:b:"', () => {
    expect(rooms.board(tenantId, 'b1')).toBe('t:t1:b:b1');
  });

  it('item: prefixo "t:<tenant>:i:"', () => {
    expect(rooms.item(tenantId, 'i1')).toBe('t:t1:i:i1');
  });

  it('dashboard: prefixo "t:<tenant>:d:"', () => {
    expect(rooms.dashboard(tenantId, 'd1')).toBe('t:t1:d:d1');
  });

  it('tenants diferentes nunca colidem no mesmo tipo de room', () => {
    expect(rooms.board('t1', 'b1')).not.toBe(rooms.board('t2', 'b1'));
  });
});

describe('constantes do protocolo', () => {
  it('canal pub/sub e janelas de presença têm os valores documentados', () => {
    expect(REALTIME_CHANNEL).toBe('cube:realtime:events');
    expect(PRESENCE_TTL_SECONDS).toBe(30);
    expect(PRESENCE_HEARTBEAT_SECONDS).toBe(10);
    // O heartbeat precisa ser bem menor que o TTL para não expirar presença entre batimentos.
    expect(PRESENCE_HEARTBEAT_SECONDS).toBeLessThan(PRESENCE_TTL_SECONDS);
  });
});
