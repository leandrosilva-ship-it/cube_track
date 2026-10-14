import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Share2, Star, Trash2 } from 'lucide-react';

import { Button } from '../components/button';
import { Kbd } from '../components/feedback';
import { IconButton } from '../components/icon-button';
import { Spinner } from '../components/spinner';

const meta: Meta<typeof Button> = {
  title: 'Componentes/Botões',
  component: Button,
  parameters: { layout: 'padded' },
  args: { children: 'Novo item', variant: 'primary', size: 'md' },
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'subtle', 'danger', 'link'],
    },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
};
export default meta;
type Story = StoryObj<typeof Button>;

export const Playground: Story = {};

export const Variantes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus aria-hidden="true" /> Novo item
      </Button>
      <Button variant="secondary">
        <Share2 aria-hidden="true" /> Compartilhar
      </Button>
      <Button variant="ghost">Cancelar</Button>
      <Button variant="subtle">Convidar</Button>
      <Button variant="danger">
        <Trash2 aria-hidden="true" /> Excluir
      </Button>
      <Button variant="link">Saiba mais</Button>
      <Button loading>Salvando</Button>
      <Button disabled>Desabilitado</Button>
    </div>
  ),
};

export const Tamanhos: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Pequeno</Button>
      <Button size="md">Médio</Button>
      <Button size="lg">Grande</Button>
    </div>
  ),
};

export const SomenteIcone: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <IconButton label="Favoritar" icon={<Star aria-hidden="true" />} />
      <IconButton
        label="Novo board"
        icon={<Plus aria-hidden="true" />}
        variant="secondary"
        shortcut="N"
      />
      <Spinner label="Carregando" />
      <span className="text-sm text-fg-muted">
        Atalho: <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>
      </span>
    </div>
  ),
};
