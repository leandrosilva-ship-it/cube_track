import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, Pencil, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../components/button';
import { CommandDialog, CommandGroup, CommandItem } from '../components/command';
import { Dialog, DialogClose, DialogTrigger, Drawer, Modal } from '../components/dialog';
import { Field } from '../components/field';
import { Input } from '../components/input';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/menu';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/tabs';
import { toast, Toaster } from '../components/toast';
import { Tooltip } from '../components/tooltip';

const meta: Meta = { title: 'Componentes/Sobreposições', parameters: { layout: 'padded' } };
export default meta;

export const ModalEDrawer: StoryObj = {
  render: () => (
    <div className="flex gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <Button>Convidar</Button>
        </DialogTrigger>
        <Modal
          title="Convidar para o board"
          description="Membros recebem um e-mail com o link de acesso."
          closeLabel="Fechar"
          footer={
            <>
              <DialogClose asChild>
                <Button variant="ghost">Cancelar</Button>
              </DialogClose>
              <Button>Enviar convite</Button>
            </>
          }
        >
          <Field label="E-mail">
            <Input type="email" placeholder="nome@empresa.com.br" />
          </Field>
        </Modal>
      </Dialog>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary">Abrir painel</Button>
        </DialogTrigger>
        <Drawer
          title="Levantamento de requisitos"
          description="Board PMSP · Em andamento"
          closeLabel="Fechar painel"
        >
          <p className="text-sm text-fg-muted">Conteúdo do painel lateral.</p>
        </Drawer>
      </Dialog>
    </div>
  ),
};

export const Menus: StoryObj = {
  render: () => (
    <div className="flex items-center gap-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Ações do board</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Board</DropdownMenuLabel>
          <DropdownMenuItem icon={<Pencil aria-hidden="true" />} shortcut="F2">
            Renomear
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Star aria-hidden="true" />}>Favoritar</DropdownMenuItem>
          <DropdownMenuItem icon={<Copy aria-hidden="true" />}>Duplicar</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem icon={<Trash2 aria-hidden="true" />} destructive>
            Excluir
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ContextMenu>
        <ContextMenuTrigger className="rounded-md border border-dashed border-border px-6 py-4 text-sm text-fg-muted">
          Clique com o botão direito
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem icon={<Pencil aria-hidden="true" />}>Renomear</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem destructive icon={<Trash2 aria-hidden="true" />}>
            Excluir
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  ),
};

export const PopoverETooltip: StoryObj = {
  render: () => (
    <div className="flex items-center gap-3">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary">Filtro</Button>
        </PopoverTrigger>
        <PopoverContent>
          <p className="font-medium">Filtro rápido</p>
          <p className="mt-1 text-fg-muted">Mostre apenas itens que atendem às condições.</p>
        </PopoverContent>
      </Popover>
      <Tooltip content="Pesquisar no board" shortcut="/">
        <Button variant="ghost">Pesquisar</Button>
      </Tooltip>
    </div>
  ),
};

export const Abas: StoryObj = {
  render: () => (
    <Tabs defaultValue="table">
      <TabsList aria-label="Views do board">
        <TabsTrigger value="table">Tabela principal</TabsTrigger>
        <TabsTrigger value="kanban">Kanban</TabsTrigger>
        <TabsTrigger value="gantt">Gantt</TabsTrigger>
      </TabsList>
      <TabsContent value="table">Tabela</TabsContent>
      <TabsContent value="kanban">Kanban</TabsContent>
      <TabsContent value="gantt">Gantt</TabsContent>
    </Tabs>
  ),
};

export const Toasts: StoryObj = {
  render: () => (
    <div className="flex gap-2">
      <Toaster label="Notificações" closeLabel="Fechar" />
      <Button onClick={() => toast.success('Board criado')}>Sucesso</Button>
      <Button variant="danger" onClick={() => toast.error('Sem permissão para editar esta coluna')}>
        Erro
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          toast('Item excluído', {
            action: { label: 'Desfazer', onClick: () => toast.success('Restaurado') },
          })
        }
      >
        Com ação
      </Button>
    </div>
  ),
};

function PaletteDemo() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Abrir paleta (Ctrl K)
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Paleta de comandos"
        placeholder="Buscar boards, ações…"
        emptyText="Nada encontrado"
      >
        <CommandGroup heading="Boards">
          <CommandItem>PMSP</CommandItem>
          <CommandItem>Marketing 2027</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Ações">
          <CommandItem shortcut="N">Novo board</CommandItem>
          <CommandItem shortcut="Ctrl /">Atalhos de teclado</CommandItem>
        </CommandGroup>
      </CommandDialog>
    </>
  );
}

export const PaletaDeComandos: StoryObj = { render: () => <PaletteDemo /> };
