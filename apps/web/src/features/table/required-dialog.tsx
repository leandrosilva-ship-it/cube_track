'use client';

import { isEmptyColumnValue } from '@cube-track/shared';
import { Button, Dialog, Label, Modal } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';

import { ValueField, type EditorValue } from './editors';
import { useCellLocale, useDirectory } from './hooks';
import { useRequiredPrompt, type RequiredPrompt } from './required-prompt';

function RequiredForm({ prompt }: { prompt: RequiredPrompt }) {
  const t = useTranslations('table.required');
  const tc = useTranslations('common');
  const directory = useDirectory([]);
  const locale = useCellLocale();
  const [values, setValues] = useState<Record<string, EditorValue>>(() =>
    Object.fromEntries(
      prompt.columns.map((column) => [
        column.key,
        (prompt.initial[column.key] as EditorValue | undefined) ?? null,
      ]),
    ),
  );
  const [touched, setTouched] = useState(false);
  const missing = prompt.columns.filter((column) =>
    isEmptyColumnValue(column.type, values[column.key]),
  );
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    setTouched(true);
    if (missing.length > 0) return;
    const filled: Record<string, Record<string, unknown>> = {};
    for (const column of prompt.columns) {
      const value = values[column.key];
      if (value !== null && value !== undefined) filled[column.key] = value;
    }
    prompt.resolve(filled);
  };
  return (
    <Modal
      title={t('title')}
      description={t('description', { name: prompt.itemName })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              prompt.resolve(null);
            }}
          >
            {tc('cancel')}
          </Button>
          <Button type="submit" form="required-fields-form">
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="required-fields-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {prompt.columns.map((column) => {
          const invalid = touched && missing.includes(column);
          return (
            <div
              key={column.key}
              className="flex flex-col gap-1.5"
              data-testid={`required-${column.key}`}
            >
              <Label>
                {column.title}
                <span className="ms-1 text-danger" aria-hidden="true">
                  *
                </span>
              </Label>
              {column.description === null ? null : (
                <p className="text-xs text-fg-muted">{column.description}</p>
              )}
              <ValueField
                column={column}
                value={values[column.key] ?? null}
                directory={directory}
                locale={locale}
                onChange={(value) => {
                  setValues((current) => ({ ...current, [column.key]: value }));
                }}
              />
              {invalid ? (
                <p className="text-xs font-medium text-danger" role="alert">
                  {t('missing', { field: column.title })}
                </p>
              ) : null}
            </div>
          );
        })}
      </form>
    </Modal>
  );
}

/** Diálogo de campos obrigatórios (montado uma vez na página do board). */
export function RequiredFieldsDialog() {
  const prompt = useRequiredPrompt();
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) prompt?.resolve(null);
      }}
    >
      {prompt === null ? null : (
        <RequiredForm
          key={prompt.itemName + prompt.columns.map((c) => c.key).join()}
          prompt={prompt}
        />
      )}
    </Dialog>
  );
}
