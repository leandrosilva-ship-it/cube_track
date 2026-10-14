import { describe, expect, it } from 'vitest';

import { isUuidV7, newId } from './ids.js';

describe('newId', () => {
  it('gera UUIDv7 ordenáveis por tempo', () => {
    const ids = Array.from({ length: 100 }, () => newId());
    expect(ids.every(isUuidV7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });

  it('rejeita UUIDs de outras versões', () => {
    expect(isUuidV7('2f1b6c0e-8d5a-4a3e-9b1c-1a2b3c4d5e6f')).toBe(false);
  });
});
