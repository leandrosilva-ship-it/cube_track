import { REPLY_ADDRESS_RE } from '@cube-track/shared';
import { describe, expect, it } from 'vitest';

import { buildReplyAddress } from './reply-address.js';

const secret = 'a-very-long-test-secret-at-least-32-chars';

describe('buildReplyAddress', () => {
  it('gera um endereço no formato esperado pelo webhook da API', () => {
    const address = buildReplyAddress(secret, 'reply.cubetrack.local', {
      itemId: '01920000-0000-7000-8000-000000000001',
      userId: '01920000-0000-7000-8000-000000000002',
      updateId: null,
    });
    expect(address.endsWith('@reply.cubetrack.local')).toBe(true);
    expect(REPLY_ADDRESS_RE.test(address)).toBe(true);
  });

  it('é determinístico para o mesmo payload e segredo', () => {
    const payload = {
      itemId: '01920000-0000-7000-8000-000000000001',
      userId: '01920000-0000-7000-8000-000000000002',
      updateId: '01920000-0000-7000-8000-000000000003',
    };
    expect(buildReplyAddress(secret, 'd', payload)).toBe(buildReplyAddress(secret, 'd', payload));
  });

  it('muda com o segredo (assinaturas diferentes)', () => {
    const payload = {
      itemId: '01920000-0000-7000-8000-000000000001',
      userId: '01920000-0000-7000-8000-000000000002',
      updateId: null,
    };
    expect(buildReplyAddress(secret, 'd', payload)).not.toBe(buildReplyAddress('other-secret-32-characters-long!', 'd', payload));
  });
});
