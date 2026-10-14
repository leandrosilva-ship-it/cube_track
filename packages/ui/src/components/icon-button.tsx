'use client';

import { forwardRef, type ReactNode } from 'react';

import { Button, type ButtonProps } from './button';
import { Tooltip } from './tooltip';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  /** Obrigatório: nome acessível e conteúdo da dica. */
  label: string;
  icon: ReactNode;
  shortcut?: string;
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Exibe a dica (padrão: sim). */
  withTooltip?: boolean;
}

/** Botão só com ícone: exige rótulo acessível e mostra dica ao focar/passar o mouse. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    shortcut,
    tooltipSide = 'bottom',
    withTooltip = true,
    variant = 'ghost',
    size = 'icon',
    ...props
  },
  ref,
) {
  const button = (
    <Button ref={ref} variant={variant} size={size} aria-label={label} {...props}>
      {icon}
    </Button>
  );
  if (!withTooltip) return button;
  return (
    <Tooltip content={label} side={tooltipSide} {...(shortcut === undefined ? {} : { shortcut })}>
      {button}
    </Tooltip>
  );
});
