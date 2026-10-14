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

function toHex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

/** Mistura `color` com preto (`amount` > 0 escurece) ou branco (`amount` < 0 clareia). */
export function shade(color: string, amount: number): string {
  const [r, g, b] = parseHex(color);
  const target = amount > 0 ? 0 : 255;
  const weight = Math.abs(amount);
  return toHex([r + (target - r) * weight, g + (target - g) * weight, b + (target - b) * weight]);
}

/**
 * Par fundo/texto com contraste ≥ `minimum` (WCAG AA = 4,5:1). Escolhe o texto de maior contraste e,
 * se ainda não bastar, escurece (texto branco) ou clareia (texto escuro) o fundo aos poucos,
 * preservando o matiz — cores de rótulos vindas do usuário continuam reconhecíveis.
 */
export function accessiblePair(
  background: string,
  minimum = 4.5,
): { background: string; text: string } {
  let base: string;
  try {
    base = toHex(parseHex(background));
  } catch {
    return { background: '#c4c4c4', text: INK };
  }
  const text = readableTextOn(base);
  if (contrastRatio(base, text) >= minimum) return { background: base, text };
  const direction = text === PAPER ? 1 : -1;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = shade(base, direction * step * 0.05);
    if (contrastRatio(candidate, text) >= minimum) return { background: candidate, text };
  }
  return { background: text === PAPER ? '#000000' : '#ffffff', text };
}

/** Cor de texto (escura ou branca) com maior contraste sobre o fundo informado. */
export function readableTextOn(background: string): string {
  try {
    return contrastRatio(background, PAPER) >= contrastRatio(background, INK) ? PAPER : INK;
  } catch {
    return INK;
  }
}
