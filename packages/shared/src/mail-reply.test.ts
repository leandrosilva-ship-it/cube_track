import { describe, expect, it } from 'vitest';

import { decodeReplyPayload, encodeReplyPayload, REPLY_ADDRESS_RE } from './mail-reply.js';

const itemId = '01920000-0000-7000-8000-000000000001';
const userId = '01920000-0000-7000-8000-000000000002';

describe('mail-reply', () => {
  it('codifica e decodifica o payload (ida e volta)', () => {
    const { encoded } = encodeReplyPayload({ itemId, userId, updateId: null });
    const decoded = decodeReplyPayload(encoded);
    expect(decoded?.payload).toEqual({ itemId, userId, updateId: null });
  });

  it('preserva o updateId quando presente', () => {
    const updateId = '01920000-0000-7000-8000-000000000003';
    const { encoded } = encodeReplyPayload({ itemId, userId, updateId });
    expect(decodeReplyPayload(encoded)?.payload.updateId).toBe(updateId);
  });

  it('rejeita payload malformado ou com ids que não são UUID', () => {
    expect(decodeReplyPayload('não-é-base64url-válido-!!!')).toBeNull();
    const bogus = Buffer.from('not-a-uuid:also-not:').toString('base64url');
    expect(decodeReplyPayload(bogus)).toBeNull();
  });

  it('REPLY_ADDRESS_RE reconhece o formato do endereço', () => {
    const match = REPLY_ADDRESS_RE.exec('reply+abcDEF123_-.deadbeef@reply.cubetrack.local');
    expect(match?.[1]).toBe('abcDEF123_-');
    expect(match?.[2]).toBe('deadbeef');
  });
});
