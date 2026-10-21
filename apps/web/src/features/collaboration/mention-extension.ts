import TiptapMention from '@tiptap/extension-mention';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions } from '@tiptap/suggestion';

import { filterMentionCandidates, type MentionCandidate } from './mention-candidates';
import { MentionList, type MentionListHandle } from './mention-list';

function positionAt(element: Element, rect: DOMRect | null): void {
  if (rect === null || !(element instanceof HTMLElement)) return;
  element.style.position = 'fixed';
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.bottom + 4}px`;
  element.style.zIndex = '60';
}

/**
 * Extensão `mention` do Tiptap (ADR 0048): `attrs` ficam em `{kind, id, label}` — `kind` diferencia
 * usuário/time/"todos" (ver `@cube-track/shared#extractMentions`). `getCandidates` é lido a cada
 * digitação, então o editor sempre sugere a lista de membros mais atual.
 */
export function createMentionExtension(getCandidates: () => MentionCandidate[]) {
  return TiptapMention.extend({
    name: 'mention',
    addAttributes() {
      return {
        id: { default: null },
        label: { default: '' },
        kind: { default: 'user' },
      };
    },
    renderText({ node }) {
      return `@${String(node.attrs.label)}`;
    },
  }).configure({
    HTMLAttributes: { class: 'mention rounded bg-primary/10 px-1 text-primary' },
    suggestion: {
      char: '@',
      items: ({ query }) => filterMentionCandidates(getCandidates(), query),
      command: ({ editor, range, props }) => {
        const candidate = props as MentionCandidate;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id: candidate.id, label: candidate.label, kind: candidate.kind } },
            { type: 'text', text: ' ' },
          ])
          .run();
      },
      render: () => {
        let component: ReactRenderer<MentionListHandle> | null = null;

        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionList, {
              props: { items: props.items, command: props.command },
              editor: props.editor,
            });
            document.body.append(component.element);
            positionAt(component.element, props.clientRect?.() ?? null);
          },
          onUpdate: (props) => {
            component?.updateProps({ items: props.items, command: props.command });
            if (component !== null) positionAt(component.element, props.clientRect?.() ?? null);
          },
          onKeyDown: (props) => {
            if (props.event.key === 'Escape') {
              component?.destroy();
              return true;
            }
            return component?.ref?.onKeyDown(props) ?? false;
          },
          onExit: () => {
            component?.element.remove();
            component?.destroy();
            component = null;
          },
        };
      },
    } satisfies Partial<SuggestionOptions<MentionCandidate>>,
  });
}
