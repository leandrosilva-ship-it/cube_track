import type { Meta, StoryObj } from '@storybook/react-vite';
import { FolderKanban, Inbox } from 'lucide-react';

import { Avatar, AvatarGroup } from '../components/avatar';
import { Badge, StatusPill } from '../components/badge';
import { Button } from '../components/button';
import { EmptyState, Skeleton } from '../components/feedback';

const meta: Meta = { title: 'Componentes/Exibição', parameters: { layout: 'padded' } };
export default meta;

const people = [
  { id: 'a1', name: 'Ana Ribeiro' },
  { id: 'c2', name: 'Carlos Lima' },
  { id: 'f3', name: 'Fernanda Souza' },
  { id: 'j4', name: 'Juliana Castro' },
  { id: 't5', name: 'Thiago Pereira' },
  { id: 'p6', name: 'Patrícia Gomes' },
];

export const Avatares: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Avatar person={people[0] ?? { id: 'x', name: 'X' }} size="xs" />
        <Avatar person={people[1] ?? { id: 'x', name: 'X' }} size="sm" />
        <Avatar person={people[2] ?? { id: 'x', name: 'X' }} size="md" />
        <Avatar person={people[3] ?? { id: 'x', name: 'X' }} size="lg" ring />
      </div>
      <AvatarGroup
        people={people}
        max={4}
        label="6 pessoas vendo este board"
        overflowLabel={(n) => `mais ${n} pessoas`}
        ring
      />
    </div>
  ),
};

export const BadgesEStatus: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Badge>Rascunho</Badge>
        <Badge tone="primary">Novo</Badge>
        <Badge tone="success">No prazo</Badge>
        <Badge tone="warning">Em risco</Badge>
        <Badge tone="danger">Atrasado</Badge>
        <Badge tone="info">Convidado</Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusPill label="Concluído" color="#00c875" />
        <StatusPill label="Em andamento" color="#fdab3d" />
        <StatusPill label="Parado" color="#df2f4a" />
        <StatusPill label="Em análise" color="#579bfc" />
        <StatusPill label="A fazer" color="#c4c4c4" />
      </div>
    </div>
  ),
};

export const EstadosVazios: StoryObj = {
  render: () => (
    <div className="grid gap-4 md:grid-cols-2">
      <EmptyState
        icon={<FolderKanban aria-hidden="true" />}
        title="Nenhum board neste workspace"
        description="Crie um board para organizar projetos, processos e demandas."
        action={<Button>Criar board</Button>}
      />
      <EmptyState
        icon={<Inbox aria-hidden="true" />}
        title="Caixa de entrada vazia"
        description="Você está em dia com as notificações."
      />
    </div>
  ),
};

export const Carregando: StoryObj = {
  render: () => (
    <div className="flex max-w-md flex-col gap-2" aria-busy="true">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-10 w-full" />
    </div>
  ),
};
