import type { Meta, StoryObj } from '@storybook/react-vite';

import { Logo, LogoMark } from '../brand/logo';
import { StatusPill } from '../components/badge';
import { contrastRatio } from '../lib/contrast';
import { BRAND, STATUS_PALETTE, THEMES } from '../tokens';

const meta: Meta = { title: 'Fundamentos/Tokens', parameters: { layout: 'padded' } };
export default meta;

function Swatch({ name, color, on }: { name: string; color: string; on: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      <div
        className="flex h-16 items-end p-2 text-xs font-semibold"
        style={{ backgroundColor: color, color: on }}
      >
        {contrastRatio(color, on).toFixed(1)}:1
      </div>
      <div className="bg-surface p-2 text-xs">
        <div className="font-medium text-fg">{name}</div>
        <div className="font-mono text-fg-muted">{color}</div>
      </div>
    </div>
  );
}

export const Marca: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Logo />
      <div className="flex items-end gap-4">
        <LogoMark className="size-16" />
        <LogoMark className="size-10" />
        <LogoMark className="size-6" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(BRAND).map(([name, color]) => (
          <Swatch
            key={name}
            name={name}
            color={color}
            on={contrastRatio(color, '#fff') >= 4.5 ? '#ffffff' : '#1b1f2e'}
          />
        ))}
      </div>
    </div>
  ),
};

export const CoresSemanticas: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      {Object.entries(THEMES).map(([theme, colors]) => (
        <section key={theme}>
          <h2 className="mb-3 text-lg font-semibold">
            Tema {theme === 'light' ? 'claro' : 'escuro'}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Object.entries(colors).map(([name, color]) => (
              <Swatch
                key={name}
                name={name}
                color={color}
                on={colors.text === color ? colors.background : colors.text}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  ),
};

export const PaletaDeStatus: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-fg-muted">
        Cores vivas para rótulos de status. O texto alterna entre tinta e branco para manter
        contraste ≥ 4,5:1 (WCAG AA) — validado em teste automatizado.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {STATUS_PALETTE.map((entry) => (
          <Swatch key={entry.name} name={entry.name} color={entry.color} on={entry.on} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {['Concluído', 'Em andamento', 'Parado', 'A fazer'].map((label, index) => (
          <StatusPill
            key={label}
            label={label}
            color={['#00c875', '#fdab3d', '#df2f4a', '#c4c4c4'][index] ?? '#c4c4c4'}
          />
        ))}
      </div>
    </div>
  ),
};

export const Tipografia: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <p className="text-3xl font-bold">Gestão de projetos, processos e portfólio</p>
      <p className="text-2xl font-semibold">Título de página — 24 px</p>
      <p className="text-lg font-semibold">Título de seção — 18 px</p>
      <p className="text-sm">
        Texto padrão da interface — 14 px. Datas: 14/10/2026 · R$ 1.500,00 · 40,00 UST
      </p>
      <p className="text-sm text-fg-muted">Texto secundário (muted)</p>
      <p className="text-xs text-fg-subtle">Legenda / metadado — 12 px</p>
      <p className="font-mono text-sm">2026-0924 · código monoespaçado</p>
    </div>
  ),
};

export const Densidade: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg-muted">
        Alterne “Densidade” na barra de ferramentas: controles e linhas encolhem no modo compacto.
      </p>
      {['Levantamento de requisitos', 'Protótipo navegável', 'Homologação'].map((name) => (
        <div
          key={name}
          className="flex h-row items-center gap-gap rounded-md border border-border bg-surface px-3 text-sm"
        >
          {name}
        </div>
      ))}
    </div>
  ),
};
