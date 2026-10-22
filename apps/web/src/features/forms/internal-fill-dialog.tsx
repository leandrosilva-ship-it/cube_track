'use client';

import { isNativeFormFieldType } from '@cube-track/shared';
import { Button, Field, Input, Modal, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import type { BoardDetail, FormField } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCellLocale, useDirectory } from '../table/hooks';
import { ValueField, type EditorValue } from '../table/editors';
import { useFormFields, useSubmitInternalForm } from './hooks';
import { sortFieldsByPosition, visibleFormFields } from './model';

export interface InternalFillDialogProps {
  board: BoardDetail;
  formId: string;
  onClose: () => void;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Preenchimento interno (autenticado, sem link público): cria um item a partir das respostas. */
export function InternalFillDialog({ board, formId, onClose }: InternalFillDialogProps) {
  const t = useTranslations('forms.internalFill');
  const tc = useTranslations('common');
  const tp = useTranslations('forms.public');
  const errorMessage = useErrorMessage();
  const fieldsQuery = useFormFields(formId);
  const submit = useSubmitInternalForm(formId);
  const directory = useDirectory([]);
  const locale = useCellLocale();
  const [answers, setAnswers] = useState<Map<string, unknown>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const fields = useMemo(() => sortFieldsByPosition(fieldsQuery.data ?? []), [fieldsQuery.data]);
  const columnTypes = useMemo(
    () =>
      new Map(
        fields
          .filter((field): field is FormField & { columnKey: string } => field.columnKey !== null)
          .map((field) => [field.columnKey, board.columns.find((column) => column.key === field.columnKey)?.type ?? field.fieldType]),
      ),
    [fields, board.columns],
  );
  const visible = useMemo(() => visibleFormFields(fields, answers, columnTypes), [fields, answers, columnTypes]);

  const setAnswer = (fieldId: string, value: unknown) => {
    setAnswers((current) => {
      const next = new Map(current);
      next.set(fieldId, value);
      return next;
    });
  };

  const onSubmit = async () => {
    setError(null);
    const missing = visible.find((field) => field.isRequired && isEmpty(answers.get(field.id)));
    if (missing !== undefined) {
      setError(tp('submitError'));
      return;
    }
    try {
      await submit.mutateAsync(Object.fromEntries(visible.map((field) => [field.id, answers.get(field.id)])));
      toast.success(t('success'));
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Modal
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            loading={submit.isPending}
            onClick={() => {
              void onSubmit();
            }}
          >
            {t('submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {fieldsQuery.isPending ? (
          <p className="text-sm text-fg-muted">{tc('loading')}</p>
        ) : (
          visible.map((field) => (
            <InternalFieldInput
              key={field.id}
              board={board}
              field={field}
              value={answers.get(field.id)}
              onChange={setAnswer}
              directory={directory}
              locale={locale}
            />
          ))
        )}
      </div>
    </Modal>
  );
}

function InternalFieldInput({
  board,
  field,
  value,
  onChange,
  directory,
  locale,
}: {
  board: BoardDetail;
  field: FormField;
  value: unknown;
  onChange: (fieldId: string, value: unknown) => void;
  directory: ReturnType<typeof useDirectory>;
  locale: ReturnType<typeof useCellLocale>;
}) {
  const tp = useTranslations('forms.public');
  const label = (
    <label className="text-sm font-medium" htmlFor={`ct-internal-field-${field.id}`}>
      {field.label}
      {field.isRequired ? <span className="ms-1 text-danger">{tp('required')}</span> : null}
    </label>
  );

  const column = field.columnKey === null ? undefined : board.columns.find((entry) => entry.key === field.columnKey);
  if (column !== undefined) {
    return (
      <Field label={label}>
        <ValueField
          column={column}
          value={(value ?? null) as EditorValue}
          onChange={(next) => {
            onChange(field.id, next);
          }}
          directory={directory}
          locale={locale}
        />
      </Field>
    );
  }

  if (!isNativeFormFieldType(field.fieldType)) {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <p className="text-xs text-fg-muted">{field.fieldType}</p>
      </div>
    );
  }

  if (field.fieldType === 'long_text') {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        <Textarea
          id={`ct-internal-field-${field.id}`}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(field.id, event.target.value);
          }}
        />
      </div>
    );
  }
  if (field.fieldType === 'checkbox') {
    return (
      <div className="flex items-center gap-2">
        <input
          id={`ct-internal-field-${field.id}`}
          type="checkbox"
          checked={value === true}
          onChange={(event) => {
            onChange(field.id, event.target.checked);
          }}
          className="size-4"
        />
        {label}
      </div>
    );
  }
  const type =
    field.fieldType === 'email'
      ? 'email'
      : field.fieldType === 'phone'
        ? 'tel'
        : field.fieldType === 'number'
          ? 'number'
          : field.fieldType === 'date'
            ? 'date'
            : 'text';
  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <Input
        id={`ct-internal-field-${field.id}`}
        type={type}
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        onChange={(event) => {
          onChange(field.id, event.target.value);
        }}
      />
    </div>
  );
}
