/**
 * Utilitários puros para o corpo rico (JSON do editor Tiptap) de atualizações, respostas e
 * descrição do item (ADR 0048). Convenção de @menção: o nó `mention` do Tiptap carrega
 * `attrs.kind` (`user`/`team`/`everyone`), `attrs.id` (uuid do alvo; `null`/ausente para
 * `everyone`) e `attrs.label` (rótulo exibido) — mesmo formato de `{id, label}` já usado nas
 * atualizações de exemplo do seed (`packages/db/src/seed/context.ts#richText`), com `kind`
 * adicionado para diferenciar usuário/time/todos.
 */

export type MentionTargetType = 'user' | 'team' | 'everyone';

export interface MentionRef {
  targetType: MentionTargetType;
  targetId: string | null;
}

interface TiptapNode {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  content?: unknown;
}

/** Monta os `attrs` do nó `mention` do Tiptap para um usuário, time ou "todos". */
export const mentionAttrs = {
  user: (id: string, label: string) => ({ kind: 'user' as const, id, label }),
  team: (id: string, label: string) => ({ kind: 'team' as const, id, label }),
  everyone: (label: string) => ({ kind: 'everyone' as const, id: null, label }),
};

function isNode(value: unknown): value is TiptapNode {
  return typeof value === 'object' && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mentionRefFromAttrs(attrs: Record<string, unknown>): MentionRef | null {
  if (attrs.kind === 'everyone') return { targetType: 'everyone', targetId: null };
  if (attrs.kind === 'user' && typeof attrs.id === 'string') return { targetType: 'user', targetId: attrs.id };
  if (attrs.kind === 'team' && typeof attrs.id === 'string') return { targetType: 'team', targetId: attrs.id };
  return null;
}

/** Extrai as @menções (sem duplicatas) de um documento Tiptap. */
export function extractMentions(doc: unknown): MentionRef[] {
  const found: MentionRef[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (!isNode(node)) return;
    if (node.type === 'mention' && isRecord(node.attrs)) {
      const ref = mentionRefFromAttrs(node.attrs);
      if (ref !== null) {
        const key = `${ref.targetType}:${ref.targetId ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push(ref);
        }
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return found;
}

/** Texto plano do documento (parágrafos separados por quebra de linha; menções viram `@rótulo`). */
export function docToPlainText(doc: unknown): string {
  const lines: string[] = [];
  let current = '';
  const flush = () => {
    lines.push(current);
    current = '';
  };
  const walk = (node: unknown): void => {
    if (!isNode(node)) return;
    if (typeof node.text === 'string') {
      current += node.text;
      return;
    }
    if (node.type === 'mention' && isRecord(node.attrs)) {
      const label = typeof node.attrs.label === 'string' ? node.attrs.label : '';
      current += `@${label}`;
      return;
    }
    if (node.type === 'hardBreak') {
      current += '\n';
      return;
    }
    const isBlock =
      node.type === 'paragraph' ||
      node.type === 'heading' ||
      node.type === 'listItem' ||
      node.type === 'codeBlock' ||
      node.type === 'blockquote';
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (isBlock) flush();
  };
  walk(doc);
  if (current.length > 0) flush();
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();
}

/** Converte texto plano em um documento Tiptap mínimo (parágrafos separados por linha em branco). */
export function textToDoc(text: string): Record<string, unknown> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (paragraphs.length === 0) return emptyDoc();
  return {
    type: 'doc',
    content: paragraphs.map((paragraph) => {
      const content: Record<string, unknown>[] = [];
      paragraph.split('\n').forEach((line, index) => {
        if (index > 0) content.push({ type: 'hardBreak' });
        if (line.length > 0) content.push({ type: 'text', text: line });
      });
      return { type: 'paragraph', content };
    }),
  };
}

/** Documento vazio padrão (parágrafo único sem conteúdo) para inicializar o editor. */
export function emptyDoc(): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function isBlankDoc(doc: unknown): boolean {
  return docToPlainText(doc).length === 0;
}
