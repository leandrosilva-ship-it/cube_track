'use client';

import { FormViewConfigSchema, type FilterGroup } from '@cube-track/shared';
import {
  Button,
  cn,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Switch,
  Textarea,
  toast,
} from '@cube-track/ui';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FileText, GripVertical, Link2, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type CSSProperties } from 'react';

import type { BoardDetail, BoardView, FormDefinition, FormField } from '@/lib/api/types';
import { useErrorMessage } from '@/lib/errors/use-error-message';

import { useUpdateView } from '../board/hooks';
import { useMembers } from '../shell/hooks';
import { FilterBuilder } from '../table/filter-builder';
import { InternalFillDialog } from './internal-fill-dialog';
import { filterFields } from '../table/filters';
import {
  useAddFormField,
  useCreateForm,
  useForm,
  useFormFields,
  useRemoveFormField,
  useSetFormPublic,
  useUpdateForm,
  useUpdateFormField,
  type FormFieldInput,
} from './hooks';
import {
  boardFieldOptions,
  nativeQuestionOptions,
  positionFor,
  sortFieldsByPosition,
  type FieldOption,
} from './model';

export interface FormBuilderViewProps {
  board: BoardDetail;
  view: BoardView;
}

/** View Formulário: construtor (campos, lógica condicional, marca e link público) — ADR 0049. */
export function FormBuilderView({ board, view }: FormBuilderViewProps) {
  const t = useTranslations('forms.builder');
  const config = FormViewConfigSchema.parse(view.config);
  const updateView = useUpdateView(board.id);
  const createForm = useCreateForm(board.id);
  const errorMessage = useErrorMessage();

  const create = async () => {
    try {
      const created = await createForm.mutateAsync({ name: view.name });
      updateView.mutate({ viewId: view.id, input: { config: { formId: created.id } } });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (config.formId === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<FileText aria-hidden="true" />}
          title={t('createTitle')}
          description={t('createDescription')}
          action={
            <Button
              loading={createForm.isPending}
              onClick={() => {
                void create();
              }}
            >
              {t('create')}
            </Button>
          }
        />
      </div>
    );
  }

  return <FormBuilder board={board} formId={config.formId} />;
}

function FormBuilder({ board, formId }: { board: BoardDetail; formId: string }) {
  const t = useTranslations('forms.builder');
  const tc = useTranslations('common');
  const formQuery = useForm(formId);
  const fieldsQuery = useFormFields(formId);
  const setPublic = useSetFormPublic(formId);
  const updateField = useUpdateFormField(formId);
  const addField = useAddFormField(formId);
  const removeField = useRemoveFormField(formId);
  const errorMessage = useErrorMessage();
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [fillOpen, setFillOpen] = useState(false);

  const fields = useMemo(() => sortFieldsByPosition(fieldsQuery.data ?? []), [fieldsQuery.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    const targetIndex = fields.findIndex((field) => field.id === over.id);
    if (targetIndex === -1) return;
    const position = positionFor(fields, String(active.id), targetIndex);
    updateField.mutate({ id: String(active.id), input: { position } });
  };

  const nativeLabels = useMemo(
    () => ({
      text: t('fieldNative.text'),
      long_text: t('fieldNative.longText'),
      email: t('fieldNative.email'),
      phone: t('fieldNative.phone'),
      number: t('fieldNative.number'),
      date: t('fieldNative.date'),
      checkbox: t('fieldNative.checkbox'),
    }),
    [t],
  );
  const nativeOptions = useMemo(() => nativeQuestionOptions(nativeLabels), [nativeLabels]);
  const columnOptions = useMemo(
    () =>
      boardFieldOptions(board, fields, {
        name: t('fieldNative.nameField'),
        description: t('fieldNative.descriptionField'),
      }),
    [board, fields, t],
  );

  const togglePublic = async (next: boolean) => {
    try {
      const result = await setPublic.mutateAsync(next);
      setRevealedToken(result.token);
      if (next) toast.success(t('publicEnabled'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const addFieldFrom = (option: FieldOption) => {
    const isNative = option.columnKey === null || option.columnKey === 'name' || option.columnKey === 'description';
    void addField.mutateAsync({
      columnKey: option.columnKey,
      label: option.label,
      ...(isNative ? { fieldType: option.fieldType } : {}),
    });
  };

  if (formQuery.isPending || formQuery.data === undefined) {
    return <div className="p-6 text-sm text-fg-muted">{tc('loading')}</div>;
  }
  const form = formQuery.data;
  const publicUrl = revealedToken === null ? null : `${window.location.origin}/public/forms/${revealedToken}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="toolbar"
        aria-label={t('title')}
        className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-6"
      >
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{form.name}</h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFillOpen(true);
          }}
        >
          {t('fill')}
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            id="ct-form-public"
            checked={form.isPublic}
            onCheckedChange={(checked) => {
              void togglePublic(checked);
            }}
          />
          <Label htmlFor="ct-form-public">{t('public')}</Label>
        </div>
      </div>
      {publicUrl !== null ? (
        <div className="flex items-center gap-2 border-b border-border bg-surface-subtle px-4 py-2 text-xs sm:px-6">
          <Link2 className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-mono">{publicUrl}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(publicUrl).then(() => {
                toast.success(t('linkCopied'));
              });
            }}
          >
            {t('copyLink')}
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 overflow-y-auto border-e border-border p-4">
          <FormSettingsPanel board={board} form={form} />
        </aside>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <SortableContext items={fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    board={board}
                    field={field}
                    nativeLabels={nativeLabels}
                    onUpdate={(input) => {
                      updateField.mutate({ id: field.id, input });
                    }}
                    onRemove={() => {
                      void removeField.mutateAsync(field.id);
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          {fields.length === 0 ? <p className="py-6 text-center text-sm text-fg-muted">{t('empty')}</p> : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" className="mt-3">
                <Plus className="size-4" aria-hidden="true" />
                {t('addField')}
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label={t('addField')} className="max-h-72 overflow-y-auto">
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                  <p className="px-2 text-xs font-semibold uppercase text-fg-muted">{t('questionsGroup')}</p>
                  {nativeOptions.map((option) => (
                    <button
                      key={`native:${option.fieldType}`}
                      type="button"
                      className="rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-hover"
                      onClick={() => {
                        addFieldFrom(option);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {columnOptions.length > 0 ? (
                  <div className="flex flex-col gap-0.5 border-t border-border pt-2">
                    <p className="px-2 text-xs font-semibold uppercase text-fg-muted">{t('columnsGroup')}</p>
                    {columnOptions.map((option) => (
                      <button
                        key={`column:${option.columnKey ?? 'none'}`}
                        type="button"
                        className="rounded-md px-2 py-1.5 text-start text-sm hover:bg-surface-hover"
                        onClick={() => {
                          addFieldFrom(option);
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <Dialog open={fillOpen} onOpenChange={setFillOpen}>
        {fillOpen ? (
          <InternalFillDialog
            board={board}
            formId={formId}
            onClose={() => {
              setFillOpen(false);
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function FormSettingsPanel({ board, form }: { board: BoardDetail; form: FormDefinition }) {
  const t = useTranslations('forms.builder');
  const update = useUpdateForm(form.id);
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description ?? '');
  const [logoUrl, setLogoUrl] = useState(form.settings.logoUrl ?? '');
  const [primaryColor, setPrimaryColor] = useState(form.settings.primaryColor ?? '');
  const [thankYouMessage, setThankYouMessage] = useState(form.settings.thankYouMessage ?? '');
  const [redirectUrl, setRedirectUrl] = useState(form.settings.redirectUrl ?? '');

  return (
    <div className="flex flex-col gap-4">
      <Field label={t('name')}>
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onBlur={() => {
            if (name.trim() !== '' && name !== form.name) update.mutate({ name: name.trim() });
          }}
        />
      </Field>
      <Field label={t('description')}>
        <Textarea
          rows={2}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
          onBlur={() => {
            const next = description.trim() === '' ? null : description;
            if (next !== (form.description ?? null)) update.mutate({ description: next });
          }}
        />
      </Field>
      <Field label={t('targetGroup')}>
        <Select
          value={form.targetGroupId ?? ''}
          options={[
            { value: '', label: t('targetGroupDefault') },
            ...board.groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
          onValueChange={(value) => {
            update.mutate({ targetGroupId: value === '' ? null : value });
          }}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Switch
          id="ct-form-requires-login"
          checked={form.requiresLogin}
          onCheckedChange={(checked) => {
            update.mutate({ requiresLogin: checked });
          }}
        />
        <Label htmlFor="ct-form-requires-login">{t('requiresLogin')}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="ct-form-active"
          checked={form.isActive}
          onCheckedChange={(checked) => {
            update.mutate({ isActive: checked });
          }}
        />
        <Label htmlFor="ct-form-active">{t('active')}</Label>
      </div>
      <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
        <legend className="text-sm font-medium text-fg">{t('branding')}</legend>
        <Field label={t('logoUrl')}>
          <Input
            value={logoUrl}
            onChange={(event) => {
              setLogoUrl(event.target.value);
            }}
            onBlur={() => {
              const next = logoUrl.trim() === '' ? null : logoUrl.trim();
              if (next !== form.settings.logoUrl) update.mutate({ settings: { logoUrl: next } });
            }}
          />
        </Field>
        <Field label={t('primaryColor')}>
          <Input
            type="color"
            value={primaryColor === '' ? '#4252d9' : primaryColor}
            onChange={(event) => {
              setPrimaryColor(event.target.value);
              update.mutate({ settings: { primaryColor: event.target.value } });
            }}
          />
        </Field>
        <Field label={t('thankYouMessage')}>
          <Textarea
            rows={2}
            value={thankYouMessage}
            onChange={(event) => {
              setThankYouMessage(event.target.value);
            }}
            onBlur={() => {
              const next = thankYouMessage.trim() === '' ? null : thankYouMessage;
              if (next !== form.settings.thankYouMessage) update.mutate({ settings: { thankYouMessage: next } });
            }}
          />
        </Field>
        <Field label={t('redirectUrl')}>
          <Input
            value={redirectUrl}
            onChange={(event) => {
              setRedirectUrl(event.target.value);
            }}
            onBlur={() => {
              const next = redirectUrl.trim() === '' ? null : redirectUrl.trim();
              if (next !== form.settings.redirectUrl) update.mutate({ settings: { redirectUrl: next } });
            }}
          />
        </Field>
      </fieldset>
    </div>
  );
}

function FieldRow({
  board,
  field,
  nativeLabels,
  onUpdate,
  onRemove,
}: {
  board: BoardDetail;
  field: FormField;
  nativeLabels: Record<string, string>;
  onUpdate: (input: FormFieldInput) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('forms.builder');
  const tf = useTranslations('table.filters');
  const tc = useTranslations('common');
  const members = useMembers();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const [label, setLabel] = useState(field.label);
  const [showWhenDraft, setShowWhenDraft] = useState<FilterGroup>(
    field.showWhen ?? { op: 'and', conditions: [] },
  );
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };
  const column = field.columnKey === null ? null : board.columns.find((entry) => entry.key === field.columnKey);
  const typeLabel = column?.title ?? nativeLabels[field.fieldType] ?? field.fieldType;
  const filterableFields = useMemo(
    () =>
      filterFields(board.columns, {
        name: tc('name'),
        group: tf('group'),
        createdAt: tf('createdAt'),
        updatedAt: tf('updatedAt'),
      }),
    [board.columns, tc, tf],
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('flex flex-col gap-2 rounded-md border border-border p-3', isDragging && 'opacity-50')}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab text-fg-subtle hover:text-fg"
          aria-label={t('reorder')}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <Input
          aria-label={t('fieldLabel')}
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
          onBlur={() => {
            if (label.trim() !== '' && label !== field.label) onUpdate({ label: label.trim() });
          }}
          className="min-w-0 flex-1"
        />
        <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-fg-muted">{typeLabel}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Switch
            id={`ct-field-required-${field.id}`}
            checked={field.isRequired}
            onCheckedChange={(checked) => {
              onUpdate({ isRequired: checked });
            }}
          />
          <Label htmlFor={`ct-field-required-${field.id}`} className="text-xs">
            {t('required')}
          </Label>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              label={t('showWhen')}
              icon={<FileText aria-hidden="true" />}
              size="icon-sm"
              className={field.showWhen !== null ? 'text-primary' : undefined}
            />
          </PopoverTrigger>
          <PopoverContent aria-label={t('showWhen')} className="w-96" align="end">
            <div className="flex flex-col gap-2">
              <p className="text-xs text-fg-muted">{t('showWhenHint')}</p>
              <FilterBuilder
                board={board}
                fields={filterableFields}
                members={members.data ?? []}
                value={showWhenDraft}
                onChange={setShowWhenDraft}
                nested={false}
              />
              <Button
                size="sm"
                className="self-end"
                onClick={() => {
                  onUpdate({ showWhen: showWhenDraft.conditions.length === 0 ? null : showWhenDraft });
                }}
              >
                {tc('save')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <IconButton label={t('removeField')} icon={<Trash2 aria-hidden="true" />} size="icon-sm" onClick={onRemove} />
      </div>
    </div>
  );
}
