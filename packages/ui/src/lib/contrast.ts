/** Utilitários de contraste WCAG 2.1 (luminância relativa). */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function parseHex(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match?.[1] === undefined) throw new RangeError(`Cor inválida: ${hex}`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

export const INK = '#1b1f2e';
export const PAPER = '#ffffff';

/** Cor de texto (escura ou branca) com maior contraste sobre o fundo informado. */
export function readableTextOn(background: string): string {
  try {
    return contrastRatio(background, PAPER) >= contrastRatio(background, INK) ? PAPER : INK;
  } catch {
    return INK;
  }
}
