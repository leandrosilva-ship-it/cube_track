import { cn } from '../lib/cn';

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Texto para leitores de tela; sem ele o spinner é decorativo. */
  label?: string;
}

const SIZES = { sm: 'size-3.5 border-2', md: 'size-5 border-2', lg: 'size-8 border-[3px]' };

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-current border-r-transparent',
        SIZES[size],
        className,
      )}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'status', 'aria-label': label })}
    />
  );
}
