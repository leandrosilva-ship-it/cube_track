'use client';

import { isNativeFormFieldType } from '@cube-track/shared';
import { Button, EmptyState, Input, Skeleton, Textarea } from '@cube-track/ui';
import { FileText, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import type { PublicFormDefinition, PublicFormField } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';
import { useSession } from '@/stores/session';

import { usePublicForm, useSubmitPublicForm } from './hooks';
import { visibleFormFields } from './model';

export interface PublicFormPageProps {
  token: string;
}

/** Página pública de preenchimento de formulário (sem login, ou com login se `requiresLogin`). */
export function PublicFormPage({ token }: PublicFormPageProps) {
  const t = useTranslations('forms.public');
  const query = usePublicForm(token);
  const authenticated = useSession((state) => state.status === 'authenticated');

  if (query.isPending) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-3 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="mx-auto flex max-w-xl items-center justify-center p-10">
        <EmptyState icon={<FileText aria-hidden="true" />} title={t('notFoundTitle')} description={t('notFoundDescription')} />
      </div>
    );
  }
  const form = query.data;
  if (form.requiresLogin && !authenticated) {
    const next = typeof window === 'undefined' ? '/' : window.location.pathname;
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 p-10 text-center">
        <Lock className="size-10 text-fg-subtle" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{t('loginRequiredTitle')}</h1>
        <p className="text-sm text-fg-muted">{t('loginRequiredDescription')}</p>
        <Button asChild>
          <a href={`/login?next=${encodeURIComponent(next)}`}>{t('loginButton')}</a>
        </Button>
      </div>
    );
  }

  return <PublicFormBody token={token} form={form} />;
}

function PublicFormBody({ token, form }: { token: string; form: PublicFormDefinition }) {
  const t = useTranslations('forms.public');
  const submit = useSubmitPublicForm(token);
  const errorMessage = useErrorMessage();
  const [answers, setAnswers] = useState<Map<string, unknown>>(new Map());
  const [honeypot, setHoneypot] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columnTypes = useMemo(
    () =>
      new Map(
        form.fields
          .filter((field): field is PublicFormField & { columnKey: string } => field.columnKey !== null)
          .map((field) => [field.columnKey, field.columnType ?? field.fieldType]),
      ),
    [form.fields],
  );
  const visible = useMemo(() => visibleFormFields(form.fields, answers, columnTypes), [form.fields, answers, columnTypes]);

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
      setError(t('submitError'));
      return;
    }
    try {
      await submit.mutateAsync({
        answers: Object.fromEntries(visible.map((field) => [field.id, answers.get(field.id)])),
        honeypot,
        ...(form.captcha === null
          ? {}
          : { captcha: { token: form.captcha.token, answer: Number(captchaAnswer) } }),
      });
      setSubmitted(true);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 p-10 text-center">
        {form.branding.logoUrl !== null ? (
          <img src={form.branding.logoUrl} alt="" className="h-12 object-contain" />
        ) : null}
        <p className="text-base">{form.branding.thankYouMessage ?? t('thankYouDefault')}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-6 sm:p-10">
      <div className="flex flex-col gap-2">
        {form.branding.logoUrl !== null ? (
          <img src={form.branding.logoUrl} alt="" className="h-10 object-contain" />
        ) : null}
        <h1 className="text-xl font-semibold">{form.name}</h1>
        {form.description !== null ? <p className="text-sm text-fg-muted">{form.description}</p> : null}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
        className="flex flex-col gap-4"
      >
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="sr-only"
          value={honeypot}
          onChange={(event) => {
            setHoneypot(event.target.value);
          }}
        />
        {visible.map((field) => (
          <PublicFieldInput key={field.id} field={field} value={answers.get(field.id)} onChange={setAnswer} />
        ))}
        {form.captcha !== null ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">
              {t('captchaLabel')} {form.captcha.question}
            </p>
            <label className="sr-only" htmlFor="ct-captcha">
              {t('captchaAnswerLabel')}
            </label>
            <Input
              id="ct-captcha"
              type="number"
              inputMode="numeric"
              value={captchaAnswer}
              onChange={(event) => {
                setCaptchaAnswer(event.target.value);
              }}
              required
            />
          </div>
        ) : null}
        {error !== null ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={submit.isPending}>
          {t('submit')}
        </Button>
      </form>
    </div>
  );
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function PublicFieldInput({
  field,
  value,
  onChange,
}: {
  field: PublicFormField;
  value: unknown;
  onChange: (fieldId: string, value: unknown) => void;
}) {
  const t = useTranslations('forms.public');
  const label = (
    <label className="text-sm font-medium" htmlFor={`ct-field-${field.id}`}>
      {field.label}
      {field.isRequired ? <span className="ms-1 text-danger">{t('required')}</span> : null}
    </label>
  );

  if (isNativeFormFieldType(field.fieldType)) {
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        {field.helpText !== null ? <p className="text-xs text-fg-muted">{field.helpText}</p> : null}
        <NativeFieldControl field={field} value={value} onChange={onChange} />
      </div>
    );
  }

  if (field.fieldType === 'status' || field.fieldType === 'dropdown') {
    const options =
      field.fieldType === 'status'
        ? field.labels.map((entry) => ({ id: entry.id, label: entry.label }))
        : field.options.map((entry) => ({ id: entry.id, label: entry.label }));
    const selected =
      value === null || typeof value !== 'object'
        ? ''
        : field.fieldType === 'status'
          ? ((value as { labelId?: string }).labelId ?? '')
          : ((value as { optionIds?: string[] }).optionIds?.[0] ?? '');
    return (
      <div className="flex flex-col gap-1.5">
        {label}
        {field.helpText !== null ? <p className="text-xs text-fg-muted">{field.helpText}</p> : null}
        <select
          id={`ct-field-${field.id}`}
          required={field.isRequired}
          value={selected}
          onChange={(event) => {
            const id = event.target.value;
            onChange(
              field.id,
              id === '' ? null : field.fieldType === 'status' ? { labelId: id } : { optionIds: [id] },
            );
          }}
          className="h-control rounded-md border border-border-strong bg-surface px-3 text-sm"
        >
          <option value="" />
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      <p className="text-xs text-fg-muted">{field.fieldType}</p>
    </div>
  );
}

function NativeFieldControl({
  field,
  value,
  onChange,
}: {
  field: PublicFormField;
  value: unknown;
  onChange: (fieldId: string, value: unknown) => void;
}) {
  if (field.fieldType === 'long_text') {
    return (
      <Textarea
        id={`ct-field-${field.id}`}
        required={field.isRequired}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => {
          onChange(field.id, event.target.value);
        }}
      />
    );
  }
  if (field.fieldType === 'checkbox') {
    return (
      <input
        id={`ct-field-${field.id}`}
        type="checkbox"
        checked={value === true}
        onChange={(event) => {
          onChange(field.id, event.target.checked);
        }}
        className="size-4"
      />
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
    <Input
      id={`ct-field-${field.id}`}
      type={type}
      required={field.isRequired}
      value={typeof value === 'string' || typeof value === 'number' ? value : ''}
      onChange={(event) => {
        onChange(field.id, event.target.value);
      }}
    />
  );
}
