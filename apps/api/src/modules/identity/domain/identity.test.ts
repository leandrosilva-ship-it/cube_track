import { describe, expect, it } from 'vitest';

import { checkPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  randomToken,
  safeEqualHex,
  sha256Hex,
} from './secrets.js';
import { base32Decode, base32Encode, generateTotp, hotp, otpauthUri, verifyTotp } from './totp.js';

// Vetores do RFC 6238 (SHA-1, segredo ASCII "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
  ])('t=%i → %s', (seconds, expected) => {
    expect(generateTotp(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it('HOTP do RFC 4226', () => {
    expect(hotp(Buffer.from('12345678901234567890'), 0)).toBe('755224');
    expect(hotp(Buffer.from('12345678901234567890'), 9)).toBe('520489');
  });

  it('aceita ±1 passo e rejeita códigos fora da janela ou malformados', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 30_000), now)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, generateTotp(RFC_SECRET, now - 90_000), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
  });

  it('base32 ida e volta e URI otpauth', () => {
    const buffer = Buffer.from('cube-track-secret');
    expect(base32Decode(base32Encode(buffer))).toEqual(buffer);
    expect(otpauthUri('ABC', 'ana@x.com')).toContain(
      'otpauth://totp/CUBE%20TRACK%3Aana%40x.com?secret=ABC',
    );
  });
});

describe('senhas', () => {
  it('hash Argon2id verificável', async () => {
    const hashed = await hashPassword('Senha-forte-2026');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hashed, 'Senha-forte-2026')).toBe(true);
    expect(await verifyPassword(hashed, 'outra-senha-2026')).toBe(false);
    expect(await verifyPassword(null, 'qualquer')).toBe(false);
  });

  it('aplica a política', () => {
    expect(checkPasswordPolicy('curta1').ok).toBe(false);
    expect(checkPasswordPolicy('somenteletras').ok).toBe(false);
    expect(checkPasswordPolicy('ana.ribeiro2026', 'ana.ribeiro@x.com').ok).toBe(false);
    expect(checkPasswordPolicy('Correta-Senha-2026', 'ana@x.com').ok).toBe(true);
  });
});

describe('segredos', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('cifra e decifra com AES-256-GCM e detecta adulteração', () => {
    const encrypted = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(decryptSecret(encrypted, key)).toBe('JBSWY3DPEHPK3PXP');
    const parts = encrypted.split(':');
    parts[3] = Buffer.from('xxxx').toString('base64url');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
  });

  it('gera tokens e códigos únicos', () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code))).toBe(true);
    expect(safeEqualHex(sha256Hex('a'), sha256Hex('a'))).toBe(true);
    expect(safeEqualHex(sha256Hex('a'), sha256Hex('b'))).toBe(false);
  });
});
