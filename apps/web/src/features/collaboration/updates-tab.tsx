'use client';

import { formatRelativeTime } from '@cube-track/i18n';
import {
  Avatar,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Skeleton,
} from '@cube-track/ui';
import { MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail, Item, ItemReply, ItemUpdate } from '@/lib/api/types';

import { Composer } from './composer';
import {
  useDeleteReply,
  useDeleteUpdate,
  useEditReply,
  useEditUpdate,
  usePinUpdate,
  usePostReply,
  usePostUpdate,
  useReplies,
  useToggleReaction,
  useUpdatesFeed,
} from './hooks';
import { ReactionBar } from './reaction-bar';
import { RichTextViewer } from './rich-text-viewer';

/** Aba "Atualizações": feed colaborativo com @menções, respostas em thread, reações e fixação. */
export function UpdatesTab({
  board,
  item,
  canComment,
  canModerate,
}: {
  board: BoardDetail;
  item: Item;
  canComment: boolean;
  canModerate: boolean;
}) {
  const t = useTranslations('itemPanel');
  const feed = useUpdatesFeed(item.id);
  const post = usePostUpdate(item.id);

  return (
    <div className="flex flex-col gap-4">
      {canComment ? (
        <Composer
          placeholder={t('composerPlaceholder')}
          submitLabel={t('post')}
          onSubmit={(doc) => post(doc)}
        />
      ) : null}
      {feed.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : feed.data === undefined || (feed.data.pinned.length === 0 && feed.data.data.length === 0) ? (
        <EmptyState icon={<MessageSquare aria-hidden="true" />} title={t('updatesEmpty')} />
      ) : (
        <div className="flex flex-col gap-3">
          {feed.data.pinned.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase text-fg-subtle">{t('pinned')}</h3>
              {feed.data.pinned.map((update) => (
                <UpdateCard
                  key={update.id}
                  board={board}
                  item={item}
                  update={update}
                  canComment={canComment}
                  canModerate={canModerate}
                />
              ))}
            </section>
          ) : null}
          {feed.data.data.map((update) => (
            <UpdateCard
              key={update.id}
              board={board}
              item={item}
              update={update}
              canComment={canComment}
              canModerate={canModerate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UpdateCard({
  item,
  update,
  canComment,
  canModerate,
}: {
  board: BoardDetail;
  item: Item;
  update: ItemUpdate;
  canComment: boolean;
  canModerate: boolean;
}) {
  const t = useTranslations('itemPanel');
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const editUpdate = useEditUpdate(item.id);
  const deleteUpdate = useDeleteUpdate(item.id);
  const pinUpdate = usePinUpdate(item.id);
  const toggleReaction = useToggleReaction(item.id);
  const canEdit = update.canEdit || canModerate;

  return (
    <article className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <Avatar
          person={{ id: update.authorId ?? 'system', name: update.authorName ?? t('system') }}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{update.authorName ?? t('system')}</span>
            <span className="text-xs text-fg-subtle">{formatRelativeTime(update.createdAt, locale)}</span>
            {update.source === 'email' ? <Badge tone="info">{t('viaEmail')}</Badge> : null}
            {update.editCount > 0 ? (
              <span className="text-xs text-fg-subtle">{t('editedAt', { date: formatRelativeTime(update.editedAt ?? update.createdAt, locale) })}</span>
            ) : null}
            {update.isPinned ? <Pin className="size-3.5 text-primary" aria-hidden="true" /> : null}
          </div>
          <div className="mt-1">
            {editing ? (
              <Composer
                initial={update.body}
                placeholder={t('composerPlaceholder')}
                submitLabel={t('save')}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- foco acionado por ação explícita (editar), não ao carregar a página
                autoFocus
                onCancel={() => {
                  setEditing(false);
                }}
                onSubmit={async (doc) => {
                  const ok = await editUpdate(update.id, doc);
                  if (ok) setEditing(false);
                  return ok;
                }}
              />
            ) : (
              <RichTextViewer doc={update.body} />
            )}
          </div>
          {editing ? null : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <ReactionBar
                reactions={update.reactions}
                onToggle={(emoji) => {
                  void toggleReaction({ type: 'update', id: update.id }, emoji);
                }}
              />
              {canComment || update.replyCount > 0 ? (
                <button
                  type="button"
                  className="text-xs text-fg-muted hover:text-fg"
                  onClick={() => {
                    setShowReplies((value) => !value);
                  }}
                >
                  {t('replies', { count: update.replyCount })}
                </button>
              ) : null}
            </div>
          )}
        </div>
        {editing || !canEdit ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={t('menu')} icon={<MoreHorizontal aria-hidden="true" />} size="icon-sm" variant="ghost" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canModerate ? (
                <DropdownMenuItem
                  icon={update.isPinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                  onSelect={() => {
                    void pinUpdate(update.id, !update.isPinned);
                  }}
                >
                  {update.isPinned ? t('unpin') : t('pin')}
                </DropdownMenuItem>
              ) : null}
              {update.canEdit ? (
                <DropdownMenuItem
                  icon={<Pencil aria-hidden="true" />}
                  onSelect={() => {
                    setEditing(true);
                  }}
                >
                  {t('edit')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                destructive
                icon={<Trash2 aria-hidden="true" />}
                onSelect={() => {
                  void deleteUpdate(update.id);
                }}
              >
                {t('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {showReplies ? (
        <ReplyThread itemId={item.id} updateId={update.id} canComment={canComment} canModerate={canModerate} />
      ) : null}
    </article>
  );
}

function ReplyThread({
  itemId,
  updateId,
  canComment,
  canModerate,
}: {
  itemId: string;
  updateId: string;
  canComment: boolean;
  canModerate: boolean;
}) {
  const t = useTranslations('itemPanel');
  const replies = useReplies(updateId, true);
  const postReply = usePostReply(itemId);

  return (
    <div className="ms-10 mt-3 flex flex-col gap-3 border-s border-border ps-3">
      {replies.isPending ? (
        <Skeleton className="h-12" />
      ) : (
        (replies.data ?? []).map((reply) => (
          <ReplyCard key={reply.id} itemId={itemId} reply={reply} canModerate={canModerate} />
        ))
      )}
      {canComment ? (
        <Composer
          placeholder={t('replyPlaceholder')}
          submitLabel={t('reply')}
          onSubmit={(doc) => postReply(updateId, doc)}
        />
      ) : null}
    </div>
  );
}

function ReplyCard({
  itemId,
  reply,
  canModerate,
}: {
  itemId: string;
  reply: ItemReply;
  canModerate: boolean;
}) {
  const t = useTranslations('itemPanel');
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const editReply = useEditReply(itemId);
  const deleteReply = useDeleteReply(itemId);
  const toggleReaction = useToggleReaction(itemId);
  const canEdit = reply.canEdit || canModerate;

  return (
    <div className="flex items-start gap-2">
      <Avatar person={{ id: reply.authorId ?? 'system', name: reply.authorName ?? t('system') }} size="xs" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{reply.authorName ?? t('system')}</span>
          <span className="text-xs text-fg-subtle">{formatRelativeTime(reply.createdAt, locale)}</span>
          {reply.source === 'email' ? <Badge tone="info">{t('viaEmail')}</Badge> : null}
        </div>
        {editing ? (
          <Composer
            initial={reply.body}
            placeholder={t('replyPlaceholder')}
            submitLabel={t('save')}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- foco acionado por ação explícita (editar), não ao carregar a página
            autoFocus
            onCancel={() => {
              setEditing(false);
            }}
            onSubmit={async (doc) => {
              const ok = await editReply(reply, doc);
              if (ok) setEditing(false);
              return ok;
            }}
          />
        ) : (
          <>
            <RichTextViewer doc={reply.body} />
            <ReactionBar
              reactions={reply.reactions}
              onToggle={(emoji) => {
                void toggleReaction({ type: 'reply', id: reply.id, updateId: reply.updateId }, emoji);
              }}
            />
          </>
        )}
      </div>
      {editing || !canEdit ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={t('menu')} icon={<MoreHorizontal aria-hidden="true" />} size="icon-sm" variant="ghost" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {reply.canEdit ? (
              <DropdownMenuItem
                icon={<Pencil aria-hidden="true" />}
                onSelect={() => {
                  setEditing(true);
                }}
              >
                {t('edit')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              destructive
              icon={<Trash2 aria-hidden="true" />}
              onSelect={() => {
                void deleteReply(reply);
              }}
            >
              {t('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
