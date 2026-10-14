'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  cn,
} from '@cube-track/ui';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Lock,
  Pencil,
  Plus,
  Star,
  StarOff,
  Trash2,
  CornerLeftUp,
  LayoutGrid,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';

import { Link } from '@/i18n/navigation';
import type { Favorite, WorkspaceTree as Tree } from '@/lib/api/types';
import { openDialog } from '@/stores/shell';

import { useDeleteFolder, useMoveNode, useToggleFavorite } from './hooks';
import { flattenTree, resolveDrop, type TreeRow } from './tree-model';

const COLLAPSED_KEY = 'ct-tree-collapsed';

function loadCollapsed(workspaceId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(`${COLLAPSED_KEY}:${workspaceId}`);
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
}

interface RowProps {
  row: TreeRow;
  tree: Tree;
  active: boolean;
  favorite: boolean;
  onToggle: (folderId: string) => void;
  onNavigate?: (() => void) | undefined;
}

function TreeItemRow({ row, tree, active, favorite, onToggle, onNavigate }: RowProps) {
  const t = useTranslations('shell.workspace');
  const tc = useTranslations('common');
  const move = useMoveNode(tree.workspaceId);
  const toggleFavorite = useToggleFavorite();
  const deleteFolder = useDeleteFolder(tree.workspaceId);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: row.id,
      disabled: !tree.canManageFolders,
    });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    paddingInlineStart: `${String(8 + row.depth * 14)}px`,
  };
  const name = row.kind === 'folder' ? row.folder.name : row.board.name;
  const rowClass = cn(
    'group flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pe-2 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg',
    active && 'bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary',
    isDragging && 'opacity-50',
    isOver && !isDragging && 'ring-2 ring-primary',
  );

  const content =
    row.kind === 'folder' ? (
      <button
        type="button"
        className={rowClass}
        style={style}
        aria-expanded={row.expanded}
        aria-label={row.expanded ? t('collapse', { name }) : t('expand', { name })}
        onClick={() => {
          onToggle(row.id);
        }}
        {...attributes}
        {...listeners}
      >
        <ChevronRight
          className={cn('size-3.5 shrink-0 transition-transform', row.expanded && 'rotate-90')}
          aria-hidden="true"
        />
        {row.expanded ? (
          <FolderOpen className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Folder className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{name}</span>
        <span className="ms-auto text-xs text-fg-subtle">{row.childCount}</span>
      </button>
    ) : (
      <Link
        href={`/w/${tree.workspaceId}/b/${row.id}`}
        className={rowClass}
        style={style}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
        {...attributes}
        {...listeners}
        // O dnd-kit define role="button"; aqui o elemento é um link de navegação.
        role="link"
      >
        <LayoutGrid className="ms-5 size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{name}</span>
        {row.board.visibility === 'private' ? (
          <Lock className="ms-auto size-3 shrink-0 text-fg-subtle" aria-label={t('private')} />
        ) : null}
      </Link>
    );

  return (
    <li ref={setNodeRef}>
      <ContextMenu>
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent
          aria-label={
            row.kind === 'folder' ? t('folderActions', { name }) : t('boardActions', { name })
          }
        >
          {row.kind === 'board' ? (
            <>
              <ContextMenuItem
                icon={favorite ? <StarOff aria-hidden="true" /> : <Star aria-hidden="true" />}
                onSelect={() => {
                  toggleFavorite.mutate({
                    entityType: 'board',
                    entityId: row.id,
                    name,
                    workspaceId: tree.workspaceId,
                    favorite: !favorite,
                  });
                }}
              >
                {favorite ? t('removeFavorite') : t('addFavorite')}
              </ContextMenuItem>
              <ContextMenuItem
                icon={<Pencil aria-hidden="true" />}
                onSelect={() => {
                  openDialog({
                    type: 'rename',
                    workspaceId: tree.workspaceId,
                    node: 'board',
                    id: row.id,
                    name,
                  });
                }}
              >
                {tc('rename')}
              </ContextMenuItem>
              {tree.canManageFolders && row.board.folderId !== null ? (
                <ContextMenuItem
                  icon={<CornerLeftUp aria-hidden="true" />}
                  onSelect={() => {
                    move.mutate({ type: 'board', id: row.id, folderId: null });
                  }}
                >
                  {t('moveToRoot')}
                </ContextMenuItem>
              ) : null}
            </>
          ) : (
            <>
              {tree.canCreateBoards ? (
                <ContextMenuItem
                  icon={<Plus aria-hidden="true" />}
                  onSelect={() => {
                    openDialog({
                      type: 'newBoard',
                      workspaceId: tree.workspaceId,
                      folderId: row.id,
                    });
                  }}
                >
                  {t('newBoard')}
                </ContextMenuItem>
              ) : null}
              {tree.canManageFolders ? (
                <>
                  <ContextMenuItem
                    icon={<FolderPlus aria-hidden="true" />}
                    onSelect={() => {
                      openDialog({
                        type: 'newFolder',
                        workspaceId: tree.workspaceId,
                        parentId: row.id,
                      });
                    }}
                  >
                    {t('newFolder')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    icon={<Pencil aria-hidden="true" />}
                    onSelect={() => {
                      openDialog({
                        type: 'rename',
                        workspaceId: tree.workspaceId,
                        node: 'folder',
                        id: row.id,
                        name,
                      });
                    }}
                  >
                    {tc('rename')}
                  </ContextMenuItem>
                  {row.folder.parentId !== null ? (
                    <ContextMenuItem
                      icon={<CornerLeftUp aria-hidden="true" />}
                      onSelect={() => {
                        move.mutate({ type: 'folder', id: row.id, parentId: null });
                      }}
                    >
                      {t('moveToRoot')}
                    </ContextMenuItem>
                  ) : null}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    destructive
                    icon={<Trash2 aria-hidden="true" />}
                    onSelect={() => {
                      if (window.confirm(t('deleteFolderConfirm', { name })))
                        deleteFolder.mutate(row.id);
                    }}
                  >
                    {t('deleteFolder')}
                  </ContextMenuItem>
                </>
              ) : null}
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

export interface WorkspaceTreeProps {
  tree: Tree;
  favorites: readonly Favorite[];
  filter: string;
  onNavigate?: () => void;
}

/**
 * Árvore de pastas e boards. Reorganização por arrastar (mouse, toque e teclado — espaço pega,
 * setas movem, espaço solta, Esc cancela), com anúncios para leitores de tela e update otimista.
 */
export function WorkspaceTree({ tree, favorites, filter, onNavigate }: WorkspaceTreeProps) {
  const t = useTranslations('shell.workspace');
  const params = useParams<{ boardId?: string }>();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(tree.workspaceId));
  const move = useMoveNode(tree.workspaceId);
  const rows = useMemo(() => flattenTree(tree, collapsed, filter), [tree, collapsed, filter]);
  const favoriteIds = useMemo(() => new Set(favorites.map((entry) => entry.entityId)), [favorites]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Enter navega/abre; só a barra de espaço pega e solta (Esc cancela).
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  const toggle = (folderId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      try {
        window.localStorage.setItem(
          `${COLLAPSED_KEY}:${tree.workspaceId}`,
          JSON.stringify([...next]),
        );
      } catch {
        // Sem armazenamento: o estado vale só nesta sessão.
      }
      return next;
    });
  };

  const nameOf = (id: string | number) => {
    const row = rows.find((entry) => entry.id === id);
    if (row === undefined) return '';
    return row.kind === 'folder' ? row.folder.name : row.board.name;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => nameOf(active.id),
    onDragOver: ({ active, over }) =>
      over === null ? nameOf(active.id) : `${nameOf(active.id)} → ${nameOf(over.id)}`,
    onDragEnd: ({ active }) => t('moved', { name: nameOf(active.id) }),
    onDragCancel: ({ active }) => nameOf(active.id),
  };
  const instructions: ScreenReaderInstructions = { draggable: t('dragHint') };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null) return;
    const source = rows.find((row) => row.id === active.id);
    const target = rows.find((row) => row.id === over.id);
    if (source === undefined || target === undefined) return;
    const intent = resolveDrop(tree, source, target);
    if (intent !== null) move.mutate(intent);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    // Setas ↑/↓ percorrem os itens da árvore (além do Tab).
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('a,button')];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    event.preventDefault();
    items[
      event.key === 'ArrowDown' ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1)
    ]?.focus();
  };

  if (rows.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-fg-muted">
        {filter === '' ? t('empty') : t('emptyFilter')}
      </p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: instructions }}
    >
      <SortableContext items={rows.map((row) => row.id)} strategy={verticalListSortingStrategy}>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- navegação por setas entre os itens */}
        <ul className="flex flex-col gap-0.5" aria-label={t('boards')} onKeyDown={onKeyDown}>
          {rows.map((row) => (
            <TreeItemRow
              key={row.id}
              row={row}
              tree={tree}
              active={row.kind === 'board' && row.id === params.boardId}
              favorite={favoriteIds.has(row.id)}
              onToggle={toggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
