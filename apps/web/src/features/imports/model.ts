import type { ImportMapping, ImportMappingTarget } from '@/lib/api/types';

/**
 * Helpers puros do importador em background (ADR 0056): conversão entre o mapeamento
 * `{type, key?}` que a API usa (`PATCH /v1/imports/:importJobId/mapping`) e o valor plano de string
 * que o `Select` de cada coluna de origem manipula. Sem I/O — testável sem rede.
 */

export function targetToSelectValue(target: ImportMappingTarget): string {
  return target.type === 'column' ? `column:${target.key}` : target.type;
}

export function selectValueToTarget(value: string): ImportMappingTarget {
  if (value.startsWith('column:')) return { type: 'column', key: value.slice('column:'.length) };
  if (value === 'name') return { type: 'name' };
  if (value === 'group') return { type: 'group' };
  return { type: 'ignore' };
}

/** O commit exige que ao menos uma coluna mapeie para o nome do item. */
export function hasNameMapping(mapping: ImportMapping): boolean {
  return Object.values(mapping).some((target) => target.type === 'name');
}
