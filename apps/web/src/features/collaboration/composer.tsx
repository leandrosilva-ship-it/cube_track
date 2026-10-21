'use client';

import { emptyDoc, isBlankDoc } from '@cube-track/shared';
import { Button } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import { useMembers } from '../shell/hooks';
import { mentionCandidates } from './mention-candidates';
import { RichTextEditor, type RichTextEditorHandle } from './rich-text-editor';

/** Caixa de composição (nova atualização ou resposta): limpa sozinha após publicar com sucesso. */
export function Composer({
  placeholder,
  submitLabel,
  autoFocus = false,
  initial,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  initial?: Record<string, unknown>;
  onSubmit: (doc: Record<string, unknown>) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const t = useTranslations('itemPanel');
  const members = useMembers();
  const ref = useRef<RichTextEditorHandle>(null);
  const [doc, setDoc] = useState<Record<string, unknown>>(initial ?? emptyDoc());
  const [sending, setSending] = useState(false);
  const candidates = useCallback(
    () => mentionCandidates(members.data ?? [], t('mentionEveryone')),
    [members.data, t],
  );

  const send = async () => {
    if (isBlankDoc(doc) || sending) return;
    setSending(true);
    const ok = await onSubmit(doc);
    setSending(false);
    if (ok) {
      ref.current?.clear();
      setDoc(emptyDoc());
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <RichTextEditor
        ref={ref}
        value={doc}
        onChange={setDoc}
        placeholder={placeholder}
        mentionCandidates={candidates}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- foco acionado por ação explícita (responder/editar), não ao carregar a página
        autoFocus={autoFocus}
        onSubmit={() => {
          void send();
        }}
        aria-label={placeholder}
      />
      <div className="flex justify-end gap-2">
        {onCancel === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <Button
          size="sm"
          disabled={sending || isBlankDoc(doc)}
          onClick={() => {
            void send();
          }}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
