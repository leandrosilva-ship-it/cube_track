'use client';

import { Button, Textarea } from '@cube-track/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { AiAssistantResponse } from '@/lib/api/types';

import { useAskAssistant } from './hooks';

/** Aba "Assistente" do diálogo de IA (ADR 0055): pergunta síncrona, sem histórico persistido — cada
 * envio é independente, como `AiAssistantService.ask` no backend. */
export function AssistantPanel({ boardId }: { boardId: string }) {
  const t = useTranslations('ai.assistant');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<AiAssistantResponse | null>(null);
  const ask = useAskAssistant(boardId);

  const submit = () => {
    const trimmed = question.trim();
    if (trimmed === '') return;
    ask.mutate(trimmed, {
      onSuccess: (response) => {
        setResult(response);
      },
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">{t('description')}</p>
      <Textarea
        value={question}
        rows={3}
        placeholder={t('questionPlaceholder')}
        aria-label={t('questionLabel')}
        onChange={(event) => {
          setQuestion(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <Button
        className="self-start"
        loading={ask.isPending}
        disabled={question.trim() === ''}
        onClick={submit}
      >
        {t('ask')}
      </Button>
      {ask.isPending ? <p className="text-sm text-fg-muted">{t('loading')}</p> : null}
      {result !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
          <p className="text-xs font-semibold uppercase text-fg-subtle">{t('answerTitle')}</p>
          <p className="whitespace-pre-wrap text-sm text-fg">{result.answer}</p>
          {result.toolCalls.length > 0 ? (
            <p className="text-xs text-fg-subtle">{t('toolsUsed', { tools: result.toolCalls.join(', ') })}</p>
          ) : null}
        </div>
      ) : ask.isPending ? null : (
        <p className="text-sm text-fg-subtle">{t('empty')}</p>
      )}
    </div>
  );
}
