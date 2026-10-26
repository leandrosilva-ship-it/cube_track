import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from './crypto.js';

const KEY = randomBytes(32).toString('base64');

describe('encryptSecret/decryptSecret', () => {
  it('cifra e decifra mantendo o texto original', () => {
    const ciphertext = encryptSecret('segredo-super-secreto', KEY);
    expect(ciphertext.startsWith('v1:')).toBe(true);
    expect(decryptSecret(ciphertext, KEY)).toBe('segredo-super-secreto');
  });

  it('rejeita payload cifrado malformado', () => {
    expect(() => decryptSecret('lixo', KEY)).toThrow('Segredo cifrado inválido');
  });

  it('rejeita decifrar com a chave errada', () => {
    const ciphertext = encryptSecret('outro segredo', KEY);
    const wrongKey = randomBytes(32).toString('base64');
    expect(() => decryptSecret(ciphertext, wrongKey)).toThrow();
  });
});
