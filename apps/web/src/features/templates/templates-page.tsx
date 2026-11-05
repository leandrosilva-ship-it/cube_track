'use client';

import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  Textarea,
  toast,
} from '@cube-track/ui';
import { TEMPLATE_KINDS } from '@cube-track/shared';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import type { Template, TemplateKind } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useMe } from '../shell/hooks';
import { ApplyTemplateDialog } from './apply-template-dialog';
import {
  useCreateTemplate,
  useDeleteTemplate,
  useInternalTemplates,
  usePublicTemplates,
  useUpdateTemplate,
  type TemplateInputBody,
} from './hooks';

const KIND_TONE: Record<TemplateKind, 'neutral' | 'info' | 'success' | 'warning'> = {
  board: 'info',
  workspace: 'success',
  dashboard: 'warning',
  automation: 'neutral',
  form: 'neutral',
};

function TemplateCard({
  template,
  canManage,
  onApply,
  onEdit,
  onDelete,
}: {
  template: Template;
  canManage: boolean;
  onApply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations('templates');
  const tc = useTranslations('common');
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{template.name}</p>
          {template.category === null ? null : <p className="text-xs text-fg-subtle">{template.category}</p>}
        </div>
        <Badge tone={KIND_TONE[template.kind]}>{t(`kind.${template.kind}`)}</Badge>
      </div>
      {template.description === null || template.description === '' ? null : (
        <p className="line-clamp-3 text-sm text-fg-muted">{template.description}</p>
      )}
      <p className="text-xs text-fg-subtle">{t('usageCount', { count: template.usageCount })}</p>
      <div className="mt-auto flex items-center gap-2 pt-2">
        <Button size="sm" onClick={onApply}>
          {tc('apply')}
        </Button>
        {canManage && onEdit !== undefined ? (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            {t('edit')}
          </Button>
        ) : null}
        {canManage && onDelete !== undefined ? (
          confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => { setConfirmDelete(false); }}>
                {tc('cancel')}
              </Button>
              <Button size="sm" variant="danger" onClick={onDelete}>
                {t('confirmDeleteAction')}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => { setConfirmDelete(true); }}>
              <Trash2 aria-hidden="true" />
              {t('delete')}
            </Button>
          )
        ) : null}
      </div>
    </li>
  );
}

type FormView = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; template: Template };

function TemplateForm({ template, onDone, onCancel }: { template?: Template; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations('templates');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const isEdit = template !== undefined;

  const [kind, setKind] = useState<TemplateKind>(template?.kind ?? 'board');
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [category, setCategory] = useState(template?.category ?? '');
  const [payloadText, setPayloadText] = useState(JSON.stringify(template?.payload ?? {}, null, 2));
  const [payloadError, setPayloadError] = useState<string | null>(null);

  const submit = async () => {
    if (name.trim() === '') {
      toast.error(t('form.incomplete'));
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      setPayloadError(t('form.invalidJson'));
      return;
    }
    setPayloadError(null);
    const body: TemplateInputBody = {
      kind,
      name: name.trim(),
      ...(description.trim() === '' ? {} : { description: description.trim() }),
      ...(category.trim() === '' ? {} : { category: category.trim() }),
      payload,
    };
    try {
      if (isEdit) {
        await update.mutateAsync({ id: template.id, input: body });
      } else {
        await create.mutateAsync(body);
      }
      onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Modal
      title={isEdit ? t('form.editTitle') : t('form.createTitle')}
      closeLabel={tc('close')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{tc('cancel')}</Button>
          <Button loading={create.isPending || update.isPending} onClick={() => void submit()}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">{t('form.description')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('form.kindLabel')}>
            <Select
              value={kind}
              disabled={isEdit}
              options={TEMPLATE_KINDS.map((value) => ({ value, label: t(`kind.${value}`) }))}
              onValueChange={(value) => { setKind(value as TemplateKind); }}
            />
          </Field>
          <Field label={t('form.categoryLabel')}>
            <Input value={category} onChange={(event) => { setCategory(event.target.value); }} />
          </Field>
        </div>
        <Field label={t('form.nameLabel')} required requiredLabel={tc('required')}>
          <Input value={name} onChange={(event) => { setName(event.target.value); }} />
        </Field>
        <Field label={t('form.descriptionLabel')}>
          <Textarea rows={2} value={description} onChange={(event) => { setDescription(event.target.value); }} />
        </Field>
        <Field label={t('form.payloadLabel')} hint={t('form.payloadHint')} error={payloadError ?? undefined}>
          <Textarea
            rows={10}
            className="font-mono text-xs"
            value={payloadText}
            onChange={(event) => { setPayloadText(event.target.value); }}
          />
        </Field>
      </div>
    </Modal>
  );
}

function Gallery({
  title,
  templates,
  canManage,
  onApply,
  onEdit,
  onDelete,
  emptyLabel,
}: {
  title: string;
  templates: Template[] | undefined;
  canManage: boolean;
  onApply: (template: Template) => void;
  onEdit?: (template: Template) => void;
  onDelete?: (template: Template) => void;
  emptyLabel: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {templates === undefined ? (
        <Skeleton className="h-40" />
      ) : templates.length === 0 ? (
        <EmptyState icon={<LayoutTemplate aria-hidden="true" />} title={emptyLabel} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              canManage={canManage}
              onApply={() => { onApply(template); }}
              {...(onEdit === undefined ? {} : { onEdit: () => { onEdit(template); } })}
              {...(onDelete === undefined ? {} : { onDelete: () => { onDelete(template); } })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Galeria de templates (ADR 0056): pública (global, só leitura) e interna (do tenant, CRUD com
 * `templates.manage`). Página autônoma, mesmo padrão de `/ai` (hub de um recurso tenant-wide). */
export function TemplatesPage() {
  const t = useTranslations('templates');
  const errorMessage = useErrorMessage();
  const me = useMe();
  const canManage = me.data?.tenant.permissions.includes('templates.manage') === true;
  const publicTemplates = usePublicTemplates();
  const internalTemplates = useInternalTemplates();
  const del = useDeleteTemplate();
  const [applying, setApplying] = useState<Template | null>(null);
  const [form, setForm] = useState<FormView>({ mode: 'closed' });

  return (
    <div className="flex flex-col gap-8 pb-10">
      <PageHeader
        title={t('title')}
        subtitle={t('description')}
        actions={
          canManage ? (
            <Button onClick={() => { setForm({ mode: 'create' }); }}>
              <Plus aria-hidden="true" />
              {t('newTemplate')}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-8 px-4 sm:px-8">
        <Gallery
          title={t('internalGalleryTitle')}
          templates={internalTemplates.data}
          canManage={canManage}
          onApply={setApplying}
          {...(canManage
            ? {
                onEdit: (template: Template) => { setForm({ mode: 'edit', template }); },
                onDelete: (template: Template) => {
                  del.mutate(template.id, {
                    onError: (error) => { toast.error(errorMessage(error)); },
                  });
                },
              }
            : {})}
          emptyLabel={t('internalGalleryEmpty')}
        />
        <Gallery
          title={t('publicGalleryTitle')}
          templates={publicTemplates.data}
          canManage={false}
          onApply={setApplying}
          emptyLabel={t('publicGalleryEmpty')}
        />
      </div>
      <Dialog open={applying !== null} onOpenChange={(open) => { if (!open) setApplying(null); }}>
        {applying === null ? null : <ApplyTemplateDialog template={applying} onDone={() => { setApplying(null); }} />}
      </Dialog>
      <Dialog open={form.mode !== 'closed'} onOpenChange={(open) => { if (!open) setForm({ mode: 'closed' }); }}>
        {form.mode === 'create' ? (
          <TemplateForm onDone={() => { setForm({ mode: 'closed' }); }} onCancel={() => { setForm({ mode: 'closed' }); }} />
        ) : null}
        {form.mode === 'edit' ? (
          <TemplateForm
            template={form.template}
            onDone={() => { setForm({ mode: 'closed' }); }}
            onCancel={() => { setForm({ mode: 'closed' }); }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
