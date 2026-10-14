/**
 * Tokens de design do CUBE TRACK (fonte da verdade). `styles/tokens.css` replica estes valores como
 * variáveis CSS — um teste garante que os dois não divergem. Documentação em docs/brand.md.
 */

export const BRAND = {
  /** Azul Cubo — cor primária. */
  primary: '#4252d9',
  /** Turquesa — face lateral do cubo e acentos. */
  accent: '#00a9a5',
  /** Lavanda — face superior do cubo. */
  highlight: '#a9b3ff',
  ink: '#1b1f2e',
} as const;

export const THEMES = {
  light: {
    background: '#f6f7fb',
    surface: '#ffffff',
    'surface-sunken': '#eef0f6',
    'surface-raised': '#ffffff',
    'surface-hover': '#eef0f6',
    border: '#d9dce6',
    'border-strong': '#8a91a8',
    text: '#1b1f2e',
    'text-muted': '#4a5068',
    'text-subtle': '#5f6680',
    primary: '#4252d9',
    'primary-hover': '#3442c4',
    'primary-foreground': '#ffffff',
    'primary-soft': '#e8eaff',
    accent: '#00a9a5',
    danger: '#c62a3c',
    'danger-soft': '#fde8ea',
    success: '#127c58',
    'success-soft': '#e3f6ee',
    warning: '#9a5300',
    'warning-soft': '#fff1dc',
    info: '#1d6aaf',
    'info-soft': '#e3f0fc',
    focus: '#4252d9',
    overlay: '#0b0d14',
  },
  dark: {
    background: '#12141c',
    surface: '#1a1d28',
    'surface-sunken': '#0e1017',
    'surface-raised': '#222634',
    'surface-hover': '#262b3b',
    border: '#2e3344',
    'border-strong': '#6b7391',
    text: '#eceef5',
    'text-muted': '#b4b9cc',
    'text-subtle': '#9298ae',
    primary: '#7b87ff',
    'primary-hover': '#9aa5ff',
    'primary-foreground': '#0b0d14',
    'primary-soft': '#262c55',
    accent: '#4eccc6',
    danger: '#ff7a86',
    'danger-soft': '#3d1f26',
    success: '#4fd6a0',
    'success-soft': '#173528',
    warning: '#ffb547',
    'warning-soft': '#3a2b14',
    info: '#6cb4ff',
    'info-soft': '#16304a',
    focus: '#9aa5ff',
    overlay: '#000000',
  },
} as const;

export type ThemeName = keyof typeof THEMES;
export type ColorToken = keyof (typeof THEMES)['light'];

/**
 * Paleta de status (rótulos de colunas Status). Cores vivas; `on` é a cor de texto com contraste
 * ≥ 4,5:1 (WCAG AA) sobre o fundo — validado em teste.
 */
export const STATUS_PALETTE = [
  { name: 'green', color: '#00c875', on: '#1b1f2e' },
  { name: 'dark-green', color: '#037f4c', on: '#ffffff' },
  { name: 'lime', color: '#9cd326', on: '#1b1f2e' },
  { name: 'yellow', color: '#ffcb00', on: '#1b1f2e' },
  { name: 'orange', color: '#fdab3d', on: '#1b1f2e' },
  { name: 'red', color: '#df2f4a', on: '#ffffff' },
  { name: 'berry', color: '#cf3350', on: '#ffffff' },
  { name: 'dark-red', color: '#bb3354', on: '#ffffff' },
  { name: 'pink', color: '#ff5ac4', on: '#1b1f2e' },
  { name: 'purple', color: '#9149d0', on: '#ffffff' },
  { name: 'dark-purple', color: '#784bd1', on: '#ffffff' },
  { name: 'indigo', color: '#5559df', on: '#ffffff' },
  { name: 'blue', color: '#579bfc', on: '#1b1f2e' },
  { name: 'dark-blue', color: '#0060b9', on: '#ffffff' },
  { name: 'sky', color: '#66ccff', on: '#1b1f2e' },
  { name: 'teal', color: '#00a9a5', on: '#1b1f2e' },
  { name: 'aqua', color: '#4eccc6', on: '#1b1f2e' },
  { name: 'brown', color: '#7f5347', on: '#ffffff' },
  { name: 'grey', color: '#c4c4c4', on: '#1b1f2e' },
  { name: 'dark-grey', color: '#757575', on: '#ffffff' },
] as const;

export const RADII = { sm: '4px', md: '6px', lg: '10px', xl: '14px', full: '9999px' } as const;

export const DENSITY = {
  comfortable: { control: '36px', row: '40px', gap: '12px' },
  compact: { control: '30px', row: '32px', gap: '8px' },
} as const;
export type Density = keyof typeof DENSITY;

export const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif';
