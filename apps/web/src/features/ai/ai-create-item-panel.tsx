'use client';

import { Button, Field, Select, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail } from '@/lib/api/types';

import { useCreateItemFromText } from './hooks';

/** Aba "Criar item" do diálogo de IA (ADR 0055): texto livre → item, com aviso de colunas que a IA
 * não conseguiu preencher a partir do texto (`skippedColumns`). */
export function CreateItemPanel({ board }: { board: BoardDetail }) {
  const t = useTranslations('ai.createItem');
  const [text, setText] = useState('');
  const [groupId, setGroupId] = useState('');
  const [result, setResult] = useState<{ name: string; skippedColumns: string[] } | null>(null);
  const create = useCreateItemFromText(board.id);

  const reset = () => {
    setText('');
    setGroupId('');
    setResult(null);
  };

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    create.mutate(
      { text: trimmed, ...(groupId === '' ? {} : { groupId }) },
      {
        onSuccess: ({ item, skippedColumns }) => {
          toast.success(t('created', { name: item.name }));
          setResult({ name: item.name, skippedColumns });
          setText('');
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t('description')}</p>
      <Field label={t('textLabel')}>
        <Textarea
          value={text}
          rows={5}
          maxLength={10_000}
          placeholder={t('textPlaceholder')}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </Field>
      <Field label={t('groupLabel')}>
        <Select
          value={groupId}
          options={[
            { value: '', label: t('noGroup') },
            ...board.groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
          onValueChange={setGroupId}
        />
      </Field>
      <Button className="self-start" loading={create.isPending} disabled={text.trim() === ''} onClick={submit}>
        {t('submit')}
      </Button>
      {result !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
          <p className="text-sm font-medium text-fg">{result.name}</p>
          {result.skippedColumns.length > 0 ? (
            <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">
              {t('skippedColumns', { columns: result.skippedColumns.join(', ') })}
            </p>
          ) : null}
          <Button variant="ghost" size="sm" className="self-start" onClick={reset}>
            {t('createAnother')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
