import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { DatePicker } from '../components/date-picker';
import { Field, Label } from '../components/field';
import { Input, Textarea } from '../components/input';
import { Select } from '../components/select';
import { Checkbox, Switch } from '../components/toggles';

const meta: Meta = { title: 'Componentes/Formulários', parameters: { layout: 'padded' } };
export default meta;

export const Campos: StoryObj = {
  render: () => (
    <form className="grid max-w-md gap-4">
      <Field
        label="Nome do board"
        required
        requiredLabel="obrigatório"
        hint="Aparece no menu lateral"
      >
        <Input placeholder="Ex.: Implantação SEI" />
      </Field>
      <Field label="E-mail" error="Informe um e-mail válido">
        <Input type="email" defaultValue="ana@" />
      </Field>
      <Field label="Descrição">
        <Textarea placeholder="Objetivo do board" />
      </Field>
      <Field label="Tipo">
        <Select
          placeholder="Escolha o tipo"
          options={[
            { value: 'board', label: 'Board' },
            { value: 'project', label: 'Projeto' },
            { value: 'process', label: 'Processo' },
            { value: 'backlog', label: 'Backlog' },
          ]}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id="unread" />
        <Label htmlFor="unread">Somente não lidas</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="compact" />
        <Label htmlFor="compact">Modo compacto</Label>
      </div>
    </form>
  ),
};

function DatePickerDemo({ locale }: { locale: 'pt-BR' | 'en' | 'es' }) {
  const [value, setValue] = useState<string | null>('2026-10-14');
  return (
    <div className="max-w-xs">
      <Field label="Prazo">
        <DatePicker
          value={value}
          onChange={setValue}
          locale={locale}
          label="Prazo"
          placeholder="Escolher data"
          clearLabel="Limpar data"
          disabledDates={['2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20']}
        />
      </Field>
      <p className="mt-2 text-xs text-fg-muted">
        Valor armazenado (data de negócio): {value ?? '—'}
      </p>
    </div>
  );
}

export const SeletorDeDataPtBR: StoryObj = { render: () => <DatePickerDemo locale="pt-BR" /> };
export const SeletorDeDataEnglish: StoryObj = { render: () => <DatePickerDemo locale="en" /> };
