import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '../../test/a11y';
import { Logo, LogoMark } from '../brand/logo';
import { Avatar, AvatarGroup, initials } from './avatar';
import { Badge, StatusPill } from './badge';
import { Button } from './button';
import { CommandDialog, CommandGroup, CommandItem } from './command';
import { Calendar, DatePicker } from './date-picker';
import { Dialog, DialogTrigger, Drawer, Modal } from './dialog';
import { EmptyState, Kbd, Skeleton } from './feedback';
import { Field } from './field';
import { IconButton } from './icon-button';
import { Input } from './input';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Select } from './select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Checkbox, Switch } from './toggles';
import { Tooltip, TooltipProvider } from './tooltip';

const people = [
  { id: '1', name: 'Ana Ribeiro' },
  { id: '2', name: 'Carlos Lima' },
  { id: '3', name: 'Fernanda Souza' },
  { id: '4', name: 'Juliana Castro' },
  { id: '5', name: 'Thiago Pereira' },
];

describe('Button e IconButton', () => {
  it('é acionável por teclado e fica ocupado durante o carregamento', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Button onClick={onClick}>Salvar</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Button onClick={onClick} loading>
        Salvar
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Salvar' })).toHaveAttribute('aria-busy', 'true');
    await expectNoA11yViolations();
  });

  it('IconButton exige nome acessível e mostra dica ao focar', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <IconButton label="Favoritar" icon={<span aria-hidden="true">★</span>} shortcut="F" />
      </TooltipProvider>,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Favoritar' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Favoritar');
    await expectNoA11yViolations();
  });
});

describe('Field e controles', () => {
  it('associa rótulo, ajuda e erro ao controle', async () => {
    render(
      <Field
        label="E-mail"
        hint="Use o e-mail corporativo"
        error="E-mail inválido"
        required
        requiredLabel="obrigatório"
      >
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /E-mail/ });
    expect(input).toHaveAccessibleDescription('Use o e-mail corporativo E-mail inválido');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail inválido');
    await expectNoA11yViolations();
  });

  it('Select abre com teclado e seleciona opção', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Field label="Idioma">
        <Select
          options={[
            { value: 'pt-BR', label: 'Português (Brasil)' },
            { value: 'en', label: 'English' },
          ]}
          placeholder="Escolha"
          onValueChange={onValueChange}
        />
      </Field>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Idioma' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'English' }));
    expect(onValueChange).toHaveBeenCalledWith('en');
  });

  it('Checkbox e Switch alternam com espaço', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Checkbox id="unread" />
        <label htmlFor="unread">Somente não lidas</label>
        <Switch aria-label="Modo compacto" />
      </div>,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Somente não lidas' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    const toggle = screen.getByRole('switch', { name: 'Modo compacto' });
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).toBeChecked();
    await expectNoA11yViolations();
  });
});

describe('DatePicker (pt-BR)', () => {
  it('exibe dd/mm/aaaa, seleciona pelo calendário e limpa', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<string | null>('2026-10-14');
      return (
        <DatePicker
          value={value}
          onChange={setValue}
          label="Prazo"
          placeholder="Escolher data"
          clearLabel="Limpar data"
        />
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Prazo: 14/10/2026' });
    await user.click(trigger);
    expect(screen.getByText(/outubro 2026/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /20 de outubro de 2026/i }));
    expect(screen.getByRole('button', { name: 'Prazo: 20/10/2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Prazo: 20/10/2026' }));
    await user.click(screen.getByRole('button', { name: 'Limpar data' }));
    expect(screen.getByRole('button', { name: 'Prazo' })).toHaveTextContent('Escolher data');
  });

  it('calendário começa na segunda-feira em pt-BR e respeita datas desabilitadas', () => {
    render(
      <Calendar value="2026-11-02" onChange={() => undefined} disabledDates={['2026-11-02']} />,
    );
    const firstWeekday = document.querySelector('thead th');
    expect(firstWeekday?.getAttribute('aria-label') ?? firstWeekday?.textContent).toMatch(
      /segunda/i,
    );
    expect(screen.getByRole('button', { name: /(^|\D)2 de novembro de 2026/i })).toBeDisabled();
  });
});

describe('Avatares, badges e status', () => {
  it('grupo de avatares anuncia rótulo e excedente', async () => {
    render(
      <AvatarGroup
        people={people}
        max={3}
        label="5 pessoas vendo"
        overflowLabel={(n) => `mais ${n}`}
      />,
    );
    expect(screen.getByRole('group', { name: '5 pessoas vendo' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ana Ribeiro' })).toHaveTextContent('AR');
    expect(screen.getByRole('img', { name: 'mais 2' })).toHaveTextContent('+2');
    expect(initials('  maria  da silva ')).toBe('MS');
    await expectNoA11yViolations();
  });

  it('status pill escolhe texto legível automaticamente', () => {
    render(
      <div>
        <StatusPill label="Concluído" color="#00c875" />
        <StatusPill label="Parado" color="#bb3354" />
        <Badge tone="success">Ativo</Badge>
        <Avatar person={{ id: 'x', name: 'Zé' }} decorative />
      </div>,
    );
    expect(screen.getByText('Concluído')).toHaveStyle({ color: 'rgb(27, 31, 46)' });
    expect(screen.getByText('Parado')).toHaveStyle({ color: 'rgb(255, 255, 255)' });
  });
});

describe('Sobreposições', () => {
  it('Modal prende o foco, fecha com Esc e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Convidar</Button>
        </DialogTrigger>
        <Modal title="Convidar pessoas" closeLabel="Fechar" footer={<Button>Enviar</Button>}>
          <Field label="E-mail">
            <Input />
          </Field>
        </Modal>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Convidar' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Convidar pessoas' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await expectNoA11yViolations(dialog);
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it('Drawer lateral com botão de fechar rotulado', async () => {
    const user = userEvent.setup();
    render(
      <Dialog defaultOpen>
        <Drawer title="Item" closeLabel="Fechar painel">
          conteúdo
        </Drawer>
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('menu suspenso navegável por setas e menu de contexto', async () => {
    const onRename = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>Mais ações</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onRename}>Renomear</DropdownMenuItem>
            <DropdownMenuItem destructive>Excluir</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ContextMenu>
          <ContextMenuTrigger>Board PMSP</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem>Abrir em nova aba</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>,
    );
    screen.getByRole('button', { name: 'Mais ações' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menu');
    await user.keyboard('{Enter}');
    expect(onRename).toHaveBeenCalled();
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('Board PMSP') });
    expect(await screen.findByRole('menuitem', { name: 'Abrir em nova aba' })).toBeInTheDocument();
  });

  it('popover e tooltip', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Popover>
          <PopoverTrigger asChild>
            <Button>Filtro</Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Filtros">Conteúdo do filtro</PopoverContent>
        </Popover>
        <Tooltip content="Ajuda">
          <Button>?</Button>
        </Tooltip>
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Filtro' }));
    expect(await screen.findByText('Conteúdo do filtro')).toBeInTheDocument();
  });

  it('abas com setas (roving tabindex)', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="table">
        <TabsList aria-label="Views">
          <TabsTrigger value="table">Tabela</TabsTrigger>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
        </TabsList>
        <TabsContent value="table">Conteúdo tabela</TabsContent>
        <TabsContent value="kanban">Conteúdo kanban</TabsContent>
      </Tabs>,
    );
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Tabela' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Kanban' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Conteúdo kanban');
    await expectNoA11yViolations();
  });
});

describe('Paleta de comandos', () => {
  it('filtra e executa com Enter', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <CommandDialog
        open
        onOpenChange={() => undefined}
        title="Paleta de comandos"
        placeholder="Buscar…"
        emptyText="Nada encontrado"
      >
        <CommandGroup heading="Boards">
          <CommandItem onSelect={onSelect}>PMSP</CommandItem>
          <CommandItem>Marketing</CommandItem>
        </CommandGroup>
      </CommandDialog>,
    );
    await user.keyboard('pms');
    expect(screen.queryByText('Marketing')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalled();
    await user.keyboard('zzz');
    expect(screen.getByText('Nada encontrado')).toBeInTheDocument();
  });
});

describe('Marca e estados', () => {
  it('logo acessível, estado vazio e skeleton decorativo', async () => {
    render(
      <div>
        <Logo />
        <LogoMark />
        <EmptyState
          title="Nenhum board"
          description="Crie o primeiro board"
          action={<Button>Criar board</Button>}
        />
        <Skeleton className="h-4" />
        <Kbd>Ctrl</Kbd>
      </div>,
    );
    expect(screen.getByRole('img', { name: 'CUBE TRACK' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nenhum board' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});
