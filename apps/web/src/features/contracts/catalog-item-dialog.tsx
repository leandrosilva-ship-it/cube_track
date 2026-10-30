'use client';

import { Button, Checkbox, Field, Input, Modal, Textarea, toast } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { CatalogItem } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useCreateCatalogItem, useUpdateCatalogItem } from './hooks';

export interface CatalogItemDialogProps {
  contractId: string;
  item?: CatalogItem;
  onClose: () => void;
}

/** Criar/editar item do catálogo de serviços (Código Edital) de um contrato — ADR 0054. */
export function CatalogItemDialog({ contractId, item, onClose }: CatalogItemDialogProps) {
  const t = useTranslations('contracts');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateCatalogItem(contractId);
  const update = useUpdateCatalogItem(contractId);
  const isEdit = item !== undefined;

  const [code, setCode] = useState(item?.code ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [defaultUst, setDefaultUst] = useState(item?.defaultUst ?? '0');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);

  const isValid = name.trim() !== '' && (isEdit || code.trim() !== '');

  const save = async () => {
    if (!isValid) return;
    try {
      if (isEdit) {
        await update.mutateAsync({
          id: item.id,
          input: {
            name: name.trim(),
            description: description.trim() === '' ? null : description.trim(),
            category: category.trim() === '' ? null : category.trim(),
            defaultUst,
            ...(unit.trim() === '' ? {} : { unit: unit.trim() }),
            isActive,
          },
        });
      } else {
        await create.mutateAsync({
          code: code.trim(),
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
          category: category.trim() === '' ? null : category.trim(),
          defaultUst,
          ...(unit.trim() === '' ? {} : { unit: unit.trim() }),
        });
      }
      toast.success(isEdit ? t('catalog.updated') : t('catalog.created'));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('catalog.editTitle') : t('catalog.newTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => void save()} loading={create.isPending || update.isPending} disabled={!isValid}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('catalog.code')}>
          <Input value={code} onChange={(event) => { setCode(event.target.value); }} disabled={isEdit} />
        </Field>
        <Field label={t('catalog.name')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label={t('catalog.description')}>
          <Textarea value={description} onChange={(event) => { setDescription(event.target.value); }} rows={2} />
        </Field>
        <Field label={t('catalog.category')}>
          <Input value={category} onChange={(event) => { setCategory(event.target.value); }} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('catalog.defaultUst')}>
            <Input
              type="number"
              min="0"
              step="0.0001"
              value={defaultUst}
              onChange={(event) => { setDefaultUst(event.target.value); }}
            />
          </Field>
          <Field label={t('catalog.unit')}>
            <Input
              value={unit}
              placeholder={t('catalog.unitPlaceholder')}
              onChange={(event) => { setUnit(event.target.value); }}
            />
          </Field>
        </div>
        {isEdit ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="catalog-item-active"
              checked={isActive}
              onCheckedChange={(value) => { setIsActive(value === true); }}
            />
            <label htmlFor="catalog-item-active" className="text-sm">
              {t('catalog.active')}
            </label>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
