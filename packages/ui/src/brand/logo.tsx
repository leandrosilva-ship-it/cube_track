import type { SVGProps } from 'react';

import { cn } from '../lib/cn';
import { BRAND } from '../tokens';

export interface LogoMarkProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Texto alternativo; omita (ou passe `decorative`) quando houver texto visível ao lado. */
  title?: string;
  decorative?: boolean;
}

/**
 * Marca CUBE TRACK: cubo isométrico com três faces — lavanda (topo), Azul Cubo (esquerda) e
 * turquesa (direita) — e uma trilha clara que atravessa as faces laterais ("track").
 */
export function LogoMark({
  title = 'CUBE TRACK',
  decorative = false,
  className,
  ...props
}: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-8 shrink-0', className)}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': title })}
      {...props}
    >
      <path d="M16 2 28 9 16 16 4 9Z" fill={BRAND.highlight} />
      <path d="M4 9 16 16 16 30 4 23Z" fill={BRAND.primary} />
      <path d="M16 16 28 9 28 23 16 30Z" fill={BRAND.accent} />
      <path
        d="M7.5 19.5 12 22l4-3.5 4.5-2.5 4-4"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface LogoProps {
  className?: string;
  /** Exibe só a marca (ex.: barra lateral recolhida). */
  compact?: boolean;
}

/** Logotipo completo: marca + nome. */
export function Logo({ className, compact = false }: LogoProps) {
  if (compact) return <LogoMark className={className} />;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark decorative />
      <span className="text-base font-extrabold tracking-[0.08em] text-fg">
        CUBE<span className="text-primary"> TRACK</span>
      </span>
    </span>
  );
}
