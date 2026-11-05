import { describe, expect, it } from 'vitest';

import { signStripePayload, verifyStripeSignature } from './billing-webhook.js';

const SECRET = 'whsec_test_segredo';
const BODY = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed' });

describe('verifyStripeSignature', () => {
  it('aceita uma assinatura válida e recente', () => {
    const now = 1_700_000_000_000;
    const header = signStripePayload(SECRET, BODY, Math.floor(now / 1_000));
    expect(verifyStripeSignature(SECRET, BODY, header, now)).toBe(true);
  });

  it('rejeita quando o segredo está errado', () => {
    const now = 1_700_000_000_000;
    const header = signStripePayload('outro-segredo', BODY, Math.floor(now / 1_000));
    expect(verifyStripeSignature(SECRET, BODY, header, now)).toBe(false);
  });

  it('rejeita quando o corpo foi adulterado (HMAC não bate mais)', () => {
    const now = 1_700_000_000_000;
    const header = signStripePayload(SECRET, BODY, Math.floor(now / 1_000));
    const tampered = JSON.stringify({ id: 'evt_123', type: 'customer.subscription.deleted' });
    expect(verifyStripeSignature(SECRET, tampered, header, now)).toBe(false);
  });

  it('rejeita um timestamp com mais de 5 minutos (replay)', () => {
    const signedAt = 1_700_000_000;
    const header = signStripePayload(SECRET, BODY, signedAt);
    const sixMinutesLater = (signedAt + 6 * 60) * 1_000;
    expect(verifyStripeSignature(SECRET, BODY, header, sixMinutesLater)).toBe(false);
  });

  it('aceita um dos vários `v1` do cabeçalho (rotação de segredo)', () => {
    const now = 1_700_000_000_000;
    const timestamp = Math.floor(now / 1_000);
    const valid = signStripePayload(SECRET, BODY, timestamp);
    const header = `t=${timestamp},v1=deadbeef,${valid}`;
    expect(verifyStripeSignature(SECRET, BODY, header, now)).toBe(true);
  });

  it('rejeita cabeçalho ausente ou malformado', () => {
    expect(verifyStripeSignature(SECRET, BODY, undefined)).toBe(false);
    expect(verifyStripeSignature(SECRET, BODY, 'garbage')).toBe(false);
    expect(verifyStripeSignature(SECRET, BODY, 't=not-a-number,v1=abc')).toBe(false);
  });
});
