import { describe, expect, it } from 'vitest';

import { EnabledModulesSchema, hasModule, isWorkspaceModule } from './modules.js';

describe('isWorkspaceModule', () => {
  it('aceita módulos conhecidos e rejeita desconhecidos', () => {
    expect(isWorkspaceModule('contracts')).toBe(true);
    expect(isWorkspaceModule('core')).toBe(true);
    expect(isWorkspaceModule('inventado')).toBe(false);
  });
});

describe('EnabledModulesSchema', () => {
  it('aceita uma lista válida contendo core', () => {
    const result = EnabledModulesSchema.safeParse(['core', 'contracts']);
    expect(result.success).toBe(true);
  });

  it('rejeita lista sem core', () => {
    const result = EnabledModulesSchema.safeParse(['contracts']);
    expect(result.success).toBe(false);
  });

  it('rejeita módulos duplicados', () => {
    const result = EnabledModulesSchema.safeParse(['core', 'contracts', 'contracts']);
    expect(result.success).toBe(false);
  });

  it('rejeita módulo desconhecido', () => {
    const result = EnabledModulesSchema.safeParse(['core', 'inventado']);
    expect(result.success).toBe(false);
  });
});

describe('hasModule', () => {
  it('verifica presença de um módulo opcional', () => {
    expect(hasModule(['core', 'contracts'], 'contracts')).toBe(true);
    expect(hasModule(['core'], 'contracts')).toBe(false);
  });
});
