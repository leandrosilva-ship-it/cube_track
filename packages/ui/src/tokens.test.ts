import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, INK, PAPER, readableTextOn } from './lib/contrast';
import { BRAND, STATUS_PALETTE, THEMES } from './tokens';

const css = readFileSync(resolve(import.meta.dirname, 'styles/tokens.css'), 'utf8');

function cssBlock(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(start, css.indexOf('}', start));
  const entries: [string, string][] = [];
  for (const match of body.matchAll(/--ct-([\w-]+):\s*(#[0-9a-f]{6});/g)) {
    entries.push([match[1] ?? '', match[2] ?? '']);
  }
  return Object.fromEntries(entries);
}

describe('tokens', () => {
  it('tokens.css replica exatamente tokens.ts nos dois temas', () => {
    expect(cssBlock("[data-theme='light']")).toEqual(THEMES.light);
    expect(cssBlock("[data-theme='dark']")).toEqual(THEMES.dark);
  });

  it.each(Object.entries(THEMES))(
    'tema %s: textos atingem contraste AA sobre as superfícies',
    (_name, theme) => {
      const surfaces = [
        theme.background,
        theme.surface,
        theme['surface-sunken'],
        theme['surface-raised'],
      ];
      for (const surface of surfaces) {
        for (const text of [
          theme.text,
          theme['text-muted'],
          theme['text-subtle'],
          theme.primary,
          theme.danger,
          theme.success,
          theme.warning,
          theme.info,
        ]) {
          expect(contrastRatio(text, surface), `${text} sobre ${surface}`).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
      expect(contrastRatio(theme['primary-foreground'], theme.primary)).toBeGreaterThanOrEqual(4.5);
      // Item ativo (texto primário sobre fundo primário suave) e badges.
      expect(contrastRatio(theme.primary, theme['primary-soft'])).toBeGreaterThanOrEqual(4.5);
      for (const tone of ['success', 'warning', 'danger', 'info'] as const) {
        expect(contrastRatio(theme[tone], theme[`${tone}-soft`]), tone).toBeGreaterThanOrEqual(4.5);
      }
      // Bordas de controles (WCAG 1.4.11: componentes de interface ≥ 3:1).
      expect(contrastRatio(theme['border-strong'], theme.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.focus, theme.surface)).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(STATUS_PALETTE.map((entry) => [entry.name, entry] as const))(
    'status %s: texto com contraste AA',
    (_name, entry) => {
      expect(contrastRatio(entry.on, entry.color)).toBeGreaterThanOrEqual(4.5);
      expect(readableTextOn(entry.color)).toBe(entry.on);
    },
  );

  it('readableTextOn escolhe a cor de maior contraste e tolera cores inválidas', () => {
    expect(readableTextOn('#000000')).toBe(PAPER);
    expect(readableTextOn('#ffffff')).toBe(INK);
    expect(readableTextOn('azul')).toBe(INK);
    expect(contrastRatio(BRAND.primary, PAPER)).toBeGreaterThanOrEqual(4.5);
  });
});
