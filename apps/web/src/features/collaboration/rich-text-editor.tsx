'use client';

import { cn } from '@cube-track/ui';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { emptyDoc } from '@cube-track/shared';

import { createMentionExtension } from './mention-extension';
import type { MentionCandidate } from './mention-candidates';

export interface RichTextEditorProps {
  value?: Record<string, unknown>;
  onChange?: (doc: Record<string, unknown>) => void;
  placeholder?: string;
  mentionCandidates: () => MentionCandidate[];
  autoFocus?: boolean;
  /** Ctrl/Cmd+Enter envia (o chamador decide o que fazer; o editor não se limpa sozinho). */
  onSubmit?: () => void;
  className?: string;
  'aria-label'?: string;
}

export interface RichTextEditorHandle {
  /** Volta ao documento vazio (usado após publicar com sucesso). */
  clear: () => void;
  focus: () => void;
}

/**
 * Editor rich text (Tiptap) para atualizações, respostas e descrição do item (ADR 0048): negrito,
 * itálico, listas, link e @menção. O corpo trafega como JSON (`doc`) — `RichTextViewer` renderiza a
 * versão somente leitura com o mesmo esquema de nós.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor(
  {
    value,
    onChange,
    placeholder,
    mentionCandidates,
    autoFocus = false,
    onSubmit,
    className,
    'aria-label': ariaLabel,
  },
  ref,
) {
  const onSubmitRef = useRef(onSubmit);
  const candidatesRef = useRef(mentionCandidates);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
    candidatesRef.current = mentionCandidates;
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2] } }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      // eslint-disable-next-line react-hooks/refs -- o Tiptap só invoca isso de forma assíncrona (ao digitar "@"), nunca durante a renderização.
      createMentionExtension(() => candidatesRef.current()),
    ],
    content: value ?? emptyDoc(),
    autofocus: autoFocus,
    editorProps: {
      attributes: { class: 'prose-cube min-h-16 outline-none', ...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel }) },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          onSubmitRef.current?.();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange?.(current.getJSON());
    },
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => editor?.commands.setContent(emptyDoc()),
      focus: () => editor?.commands.focus(),
    }),
    [editor],
  );

  return (
    <div className={cn('rounded-md border border-border bg-surface focus-within:ring-2 focus-within:ring-primary', className)}>
      {editor !== null ? <Toolbar editor={editor} /> : null}
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

function Toolbar({ editor }: { editor: Editor }) {
  const buttons = [
    { icon: Bold, label: 'Negrito', active: () => editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { icon: Italic, label: 'Itálico', active: () => editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
    {
      icon: List,
      label: 'Lista',
      active: () => editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: 'Lista numerada',
      active: () => editor.isActive('orderedList'),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ];
  return (
    <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
      {buttons.map(({ icon: Icon, label, active, run }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          aria-pressed={active()}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded text-fg-muted hover:bg-surface-hover hover:text-fg',
            active() && 'bg-surface-hover text-fg',
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            run();
          }}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

