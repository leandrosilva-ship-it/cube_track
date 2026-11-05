'use client';

import { Button, Checkbox, Field, Input, Modal, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useSaveBoardAsTemplate } from './hooks';

/** "Salvar como template" (ADR 0056) — tira um snapshot do board atual (grupos/colunas e,
 * opcionalmente, itens) para a galeria interna do tenant. Entrada no cabeçalho do board. */
export function SaveAsTemplateDialog({ boardId, onDone }: { boardId: string; onDone: () => void }) {
  const t = useTranslations('templates');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const save = useSaveBoardAsTemplate(boardId);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [includeItems, setIncludeItems] = useState(false);

  const submit = async () => {
    if (name.trim() === '') {
      toast.error(t('saveAsTemplate.incomplete'));
      return;
    }
    try {
      await save.mutateAsync({
        name: name.trim(),
        ...(description.trim() === '' ? {} : { description: description.trim() }),
        ...(category.trim() === '' ? {} : { category: category.trim() }),
        includeItems,
      });
      toast.success(t('saveAsTemplate.success'));
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={t('saveAsTemplate.title')}
      description={t('saveAsTemplate.description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            {tc('cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => void submit()}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('saveAsTemplate.nameLabel')} required requiredLabel={tc('required')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label={t('saveAsTemplate.descriptionLabel')}>
          <Textarea rows={2} value={description} onChange={(event) => { setDescription(event.target.value); }} />
        </Field>
        <Field label={t('saveAsTemplate.categoryLabel')}>
          <Input value={category} onChange={(event) => { setCategory(event.target.value); }} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={includeItems} onCheckedChange={(checked) => { setIncludeItems(checked === true); }} />
          {t('saveAsTemplate.includeItems')}
        </label>
        <p className="text-xs text-fg-subtle">{t('saveAsTemplate.includeItemsHint')}</p>
      </div>
    </Modal>
  );
}
