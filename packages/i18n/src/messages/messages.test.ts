import { describe, expect, it } from 'vitest';

import { MESSAGES } from './index.js';

interface Tree {
  [key: string]: string | Tree;
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') entries.set(path, value);
    else for (const [nested, text] of flatten(value, path)) entries.set(nested, text);
  }
  return entries;
}

/**
 * Nomes de argumentos ICU (`{name}`, `{count, plural, …}`). Ignora o corpo de ramos de
 * plural/select com uma só palavra (`one {Duplicar}`, `=0 {Restaurar}`), que não é argumento.
 */
function argumentsOf(text: string): string[] {
  const pattern = /(?<!(?:zero|one|two|few|many|other|=\d+)\s*)\{(\w+)\s*[,}]/g;
  return [...new Set([...text.matchAll(pattern)].map((match) => match[1] ?? ''))].sort();
}

const base = flatten(MESSAGES['pt-BR']);

describe('mensagens', () => {
  it.each(['en', 'es'] as const)('%s tem as mesmas chaves e argumentos do pt-BR', (locale) => {
    const translated = flatten(MESSAGES[locale]);
    expect([...translated.keys()].sort()).toEqual([...base.keys()].sort());
    for (const [key, text] of base) {
      expect(argumentsOf(translated.get(key) ?? ''), key).toEqual(argumentsOf(text));
      expect((translated.get(key) ?? '').trim(), key).not.toBe('');
    }
  });

  it('chaves balanceadas e sem texto vazio no pt-BR', () => {
    for (const [key, text] of base) {
      expect(text.split('{').length, key).toBe(text.split('}').length);
      expect(text.trim(), key).not.toBe('');
    }
  });
});
