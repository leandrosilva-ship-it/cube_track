import { describe, expect, it } from 'vitest';

import {
  isCustomPricedPlan,
  isPlanTier,
  isWithinBoardLimit,
  isWithinItemLimit,
  isWithinSeatLimit,
  isWithinStorageLimit,
  PLAN_CATALOG,
  PLAN_TIERS,
  planIncludesModule,
} from './billing.js';

describe('PLAN_CATALOG', () => {
  it('tem uma entrada para cada plano de PLAN_TIERS', () => {
    for (const tier of PLAN_TIERS) {
      expect(PLAN_CATALOG[tier].tier).toBe(tier);
    }
  });

  it('Free tem preço zero e limites definidos (nunca nulos)', () => {
    const free = PLAN_CATALOG.free;
    expect(free.priceBRL).toBe('0.00');
    expect(free.limits.maxSeats).not.toBeNull();
    expect(free.limits.maxBoardsPerWorkspace).not.toBeNull();
    expect(free.limits.maxItemsPerBoard).not.toBeNull();
    expect(free.limits.maxStorageBytes).not.toBeNull();
  });

  it('Enterprise não tem nenhum limite (tudo null) e inclui todos os módulos opcionais', () => {
    const enterprise = PLAN_CATALOG.enterprise;
    expect(enterprise.limits).toEqual({
      maxSeats: null,
      maxBoardsPerWorkspace: null,
      maxItemsPerBoard: null,
      maxStorageBytes: null,
    });
    expect(planIncludesModule('enterprise', 'contracts')).toBe(true);
    expect(planIncludesModule('enterprise', 'ai')).toBe(true);
  });

  it('planos pagos custam mais que o Free e preço é sempre decimal string com 2 casas', () => {
    for (const tier of PLAN_TIERS) {
      expect(PLAN_CATALOG[tier].priceBRL).toMatch(/^\d+\.\d{2}$/);
    }
    expect(Number(PLAN_CATALOG.pro.priceBRL)).toBeGreaterThan(Number(PLAN_CATALOG.free.priceBRL));
    expect(Number(PLAN_CATALOG.business.priceBRL)).toBeGreaterThan(Number(PLAN_CATALOG.pro.priceBRL));
  });

  it('isCustomPricedPlan só é true para enterprise', () => {
    expect(isCustomPricedPlan('enterprise')).toBe(true);
    expect(isCustomPricedPlan('free')).toBe(false);
    expect(isCustomPricedPlan('business')).toBe(false);
  });
});

describe('isPlanTier', () => {
  it('aceita só os 4 tiers conhecidos', () => {
    expect(isPlanTier('free')).toBe(true);
    expect(isPlanTier('pro')).toBe(true);
    expect(isPlanTier('business')).toBe(true);
    expect(isPlanTier('enterprise')).toBe(true);
    expect(isPlanTier('ultra')).toBe(false);
  });
});

describe('isWithinSeatLimit', () => {
  it('bloqueia a vaga além do limite do Free (5)', () => {
    expect(isWithinSeatLimit('free', 4)).toBe(true); // 4 + 1 = 5, cabe
    expect(isWithinSeatLimit('free', 5)).toBe(false); // 5 + 1 = 6, estoura
  });

  it('Enterprise nunca bloqueia (sem limite)', () => {
    expect(isWithinSeatLimit('enterprise', 10_000)).toBe(true);
  });

  it('respeita o parâmetro `additional` (convite em lote)', () => {
    expect(isWithinSeatLimit('free', 2, 3)).toBe(true); // 2 + 3 = 5
    expect(isWithinSeatLimit('free', 2, 4)).toBe(false); // 2 + 4 = 6
  });
});

describe('isWithinItemLimit', () => {
  it('respeita o limite de itens por board do plano (Free: 200)', () => {
    expect(PLAN_CATALOG.free.limits.maxItemsPerBoard).toBe(200);
    expect(isWithinItemLimit('free', 199)).toBe(true);
    expect(isWithinItemLimit('free', 200)).toBe(false);
  });
});

describe('isWithinBoardLimit', () => {
  it('respeita o limite de boards por workspace do plano (Free: 3)', () => {
    expect(PLAN_CATALOG.free.limits.maxBoardsPerWorkspace).toBe(3);
    expect(isWithinBoardLimit('free', 2)).toBe(true);
    expect(isWithinBoardLimit('free', 3)).toBe(false);
  });

  it('Business não limita boards por workspace', () => {
    expect(isWithinBoardLimit('business', 1_000_000)).toBe(true);
  });
});

describe('isWithinStorageLimit', () => {
  it('respeita o limite de armazenamento do plano (bytes)', () => {
    const maxBytes = 1 * 1024 ** 3;
    expect(PLAN_CATALOG.free.limits.maxStorageBytes).toBe(maxBytes);
    expect(isWithinStorageLimit('free', maxBytes - 100, 50)).toBe(true);
    expect(isWithinStorageLimit('free', maxBytes - 10, 50)).toBe(false);
  });

  it('Enterprise nunca bloqueia armazenamento', () => {
    expect(isWithinStorageLimit('enterprise', Number.MAX_SAFE_INTEGER, 1)).toBe(true);
  });
});
