'use client';

import { format as formatDate, parseISO, type Locale as DateFnsLocale } from 'date-fns';
import { enUS, es, ptBR } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { DayPicker, type Matcher } from 'react-day-picker';

import { cn } from '../lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export type DatePickerLocale = 'pt-BR' | 'en' | 'es';

const LOCALES: Record<DatePickerLocale, DateFnsLocale> = { 'pt-BR': ptBR, en: enUS, es };
const DISPLAY_FORMAT: Record<DatePickerLocale, string> = {
  'pt-BR': 'dd/MM/yyyy',
  en: 'MM/dd/yyyy',
  es: 'dd/MM/yyyy',
};

export interface CalendarProps {
  /** Data de negócio `YYYY-MM-DD` (sem fuso). */
  value: string | null;
  onChange: (value: string | null) => void;
  locale?: DatePickerLocale;
  /** Datas desabilitadas (ex.: feriados) no formato `YYYY-MM-DD`. */
  disabledDates?: readonly string[];
  className?: string;
}

const toBusinessDate = (date: Date) => formatDate(date, 'yyyy-MM-dd');

/** Calendário mensal (segunda como primeiro dia em pt-BR/es) navegável por teclado. */
export function Calendar({
  value,
  onChange,
  locale = 'pt-BR',
  disabledDates = [],
  className,
}: CalendarProps) {
  const selected = value === null ? undefined : parseISO(value);
  const disabled: Matcher[] = disabledDates.map((date) => parseISO(date));
  return (
    <DayPicker
      mode="single"
      locale={LOCALES[locale]}
      weekStartsOn={locale === 'en' ? 0 : 1}
      {...(selected === undefined ? {} : { selected, defaultMonth: selected })}
      disabled={disabled}
      onSelect={(date) => {
        onChange(date === undefined ? null : toBusinessDate(date));
      }}
      className={cn('text-sm', className)}
      classNames={{
        months: 'flex flex-col',
        month_caption: 'flex h-8 items-center justify-center font-semibold capitalize',
        nav: 'absolute inset-x-1 top-1 flex justify-between',
        button_previous:
          'inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover',
        button_next:
          'inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover',
        month_grid: 'mt-2 border-collapse',
        weekdays: 'text-xs text-fg-subtle',
        weekday: 'size-9 font-medium capitalize',
        day: 'p-0 text-center',
        day_button:
          'inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-hover aria-selected:bg-primary aria-selected:text-primary-foreground',
        selected: 'font-semibold',
        today: 'text-primary font-semibold',
        outside: 'text-fg-subtle opacity-60',
        disabled: 'opacity-40 line-through',
        root: 'relative',
      }}
    />
  );
}

export interface DatePickerProps extends CalendarProps {
  /** Rótulo acessível do botão (ex.: "Escolher prazo"). */
  label: string;
  placeholder: string;
  /** Rótulo para limpar a data. */
  clearLabel: string;
  id?: string;
  disabled?: boolean;
}

/** Campo de data com calendário em popover; exibe no formato do idioma (dd/mm/aaaa em pt-BR). */
export function DatePicker({
  value,
  onChange,
  locale = 'pt-BR',
  label,
  placeholder,
  clearLabel,
  id,
  disabled = false,
  disabledDates,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const display = value === null ? null : formatDate(parseISO(value), DISPLAY_FORMAT[locale]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        aria-label={display === null ? label : `${label}: ${display}`}
        className={cn(
          'inline-flex h-control w-full items-center gap-2 rounded-md border border-border-strong bg-surface px-3 text-start text-sm hover:border-fg-subtle disabled:opacity-60',
          display === null && 'text-fg-subtle',
          className,
        )}
      >
        <CalendarDays className="size-4 text-fg-muted" aria-hidden="true" />
        {display ?? placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <Calendar
          value={value}
          locale={locale}
          {...(disabledDates === undefined ? {} : { disabledDates })}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
        {value === null ? null : (
          <button
            type="button"
            className="mt-2 w-full rounded-md py-1.5 text-sm text-fg-muted hover:bg-surface-hover"
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            {clearLabel}
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
