'use client';

import { cn } from '@cube-track/ui';
import { generateHTML } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { useMemo } from 'react';

import { createMentionExtension } from './mention-extension';

const EXTENSIONS = [
  StarterKit.configure({ heading: { levels: [1, 2] } }),
  Link.configure({ openOnClick: true, autolink: true }),
  createMentionExtension(() => []),
];

export interface RichTextViewerProps {
  doc: Record<string, unknown>;
  className?: string;
}

/** Renderização somente leitura de um documento Tiptap (ADR 0048) — sem montar um editor por item. */
export function RichTextViewer({ doc, className }: RichTextViewerProps) {
  const html = useMemo(() => {
    try {
      return generateHTML(doc, EXTENSIONS);
    } catch {
      return '';
    }
  }, [doc]);
  // HTML gerado a partir do esquema de nós do Tiptap (generateHTML), não de entrada livre do usuário.
  return <div className={cn('prose-cube', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
