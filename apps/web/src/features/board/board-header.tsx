'use client';

import {
  AvatarGroup,
  Button,
  Dialog,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Textarea,
  Tooltip,
  toast,
} from '@cube-track/ui';
import {
  Bot,
  Link2,
  MoreHorizontal,
  Pencil,
  Plug,
  Share2,
  Star,
  UserPlus,
  Zap,
  LayoutTemplate,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BoardDetail } from '@/lib/api/types';
import { openDialog } from '@/stores/shell';
import { useSession } from '@/stores/session';

import { useFavorites, useToggleFavorite } from '../workspace/hooks';
import { InviteDialog, ShareDialog } from './board-dialogs';
import { useUpdateBoardDetails } from './hooks';
import { IconPicker } from './board-icon';
import { useBoardPresence } from './presence';

/** Botão de módulo ainda não habilitado: focável, com explicação (aria-disabled, não some). */
function ModuleButton({
  icon,
  label,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Tooltip content={hint}>
      <Button
        variant="ghost"
        size="sm"
        aria-disabled="true"
        onClick={(event) => {
          event.preventDefault();
        }}
      >
        {icon}
        <span className="hidden xl:inline">{label}</span>
        <span className="sr-only xl:hidden">{label}</span>
      </Button>
    </Tooltip>
  );
}

export function BoardHeader({ board }: { board: BoardDetail }) {
  const t = useTranslations('board');
  const tc = useTranslations('common');
  const present = useBoardPresence(board.id);
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const update = useUpdateBoardDetails(board.id);
  const canManage = board.permissions.includes('board.manage');
  const canInvite = useSession((state) => state.tenant !== null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board.description ?? '');
  const [dialog, setDialog] = useState<'invite' | 'share' | null>(null);
  const isFavorite = (favorites.data ?? []).some((entry) => entry.entityId === board.id);

  const saveDescription = () => {
    setEditing(false);
    const next = draft.trim() === '' ? null : draft.trim();
    if (next !== board.description) update.mutate({ description: next });
  };

  return (
    <header className="flex flex-col gap-2 px-4 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <IconPicker
          value={board.icon}
          disabled={!canManage}
          onChange={(icon) => {
            update.mutate({ icon });
          }}
        />
        <h1 className="min-w-0 truncate text-xl font-semibold sm:text-2xl">{board.name}</h1>
        <IconButton
          label={isFavorite ? t('unfavorite') : t('favorite')}
          aria-pressed={isFavorite}
          size="icon-sm"
          icon={
            <Star
              aria-hidden="true"
              className={isFavorite ? 'fill-warning text-warning' : undefined}
            />
          }
          onClick={() => {
            toggleFavorite.mutate({
              entityType: 'board',
              entityId: board.id,
              name: board.name,
              workspaceId: board.workspaceId,
              favorite: !isFavorite,
            });
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={t('menu')}
              icon={<MoreHorizontal aria-hidden="true" />}
              size="icon-sm"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {canManage ? (
              <DropdownMenuItem
                icon={<Pencil aria-hidden="true" />}
                onSelect={() => {
                  openDialog({
                    type: 'rename',
                    workspaceId: board.workspaceId,
                    node: 'board',
                    id: board.id,
                    name: board.name,
                  });
                }}
              >
                {tc('rename')}
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <DropdownMenuItem
                icon={<Pencil aria-hidden="true" />}
                onSelect={() => {
                  setDraft(board.description ?? '');
                  setEditing(true);
                }}
              >
                {t('editDescription')}
              </DropdownMenuItem>
            ) : null}
            {canManage ? (
              <DropdownMenuItem
                icon={<LayoutTemplate aria-hidden="true" />}
                onSelect={() => {
                  update.mutate(
                    { isTemplate: !board.isTemplate },
                    {
                      onSuccess: () =>
                        toast.success(board.isTemplate ? t('templateRemoved') : t('templateSaved')),
                    },
                  );
                }}
              >
                {board.isTemplate ? t('unmarkTemplate') : t('markTemplate')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              icon={<Link2 aria-hidden="true" />}
              onSelect={() => {
                void navigator.clipboard
                  .writeText(window.location.href)
                  .then(() => toast.success(tc('copied')));
              }}
            >
              {t('copyLink')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ms-auto flex flex-wrap items-center gap-1">
          {present.length > 0 ? (
            <AvatarGroup
              people={present}
              max={4}
              ring
              label={t('presence', { count: present.length })}
              overflowLabel={(count) => t('presenceMore', { count })}
              className="me-2"
            />
          ) : (
            <span className="sr-only" aria-live="polite">
              {t('presence', { count: 0 })}
            </span>
          )}
          <Dialog
            open={dialog !== null}
            onOpenChange={(open) => {
              if (!open) setDialog(null);
            }}
          >
            {canInvite ? (
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setDialog('invite');
                  }}
                >
                  <UserPlus aria-hidden="true" />
                  {t('invite')}
                </Button>
              </DialogTrigger>
            ) : null}
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDialog('share');
                }}
              >
                <Share2 aria-hidden="true" />
                <span className="hidden sm:inline">{t('share')}</span>
                <span className="sr-only sm:hidden">{t('share')}</span>
              </Button>
            </DialogTrigger>
            {dialog === 'invite' ? (
              <InviteDialog
                onDone={() => {
                  setDialog(null);
                }}
              />
            ) : null}
            {dialog === 'share' ? <ShareDialog boardId={board.id} canManage={canManage} /> : null}
          </Dialog>
          <ModuleButton
            icon={<Plug aria-hidden="true" />}
            label={t('integrate')}
            hint={t('featureLater')}
          />
          <ModuleButton
            icon={<Zap aria-hidden="true" />}
            label={t('automate')}
            hint={t('featureLater')}
          />
          <ModuleButton
            icon={<Bot aria-hidden="true" />}
            label={t('agents')}
            hint={t('featureLater')}
          />
        </div>
      </div>
      {editing ? (
        <Textarea
          value={draft}
          aria-label={t('editDescription')}
          rows={2}
          maxLength={2000}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onBlur={saveDescription}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false);
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              saveDescription();
            }
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- edição iniciada pelo usuário
          autoFocus
        />
      ) : board.description !== null && board.description !== '' ? (
        <p className="max-w-3xl text-sm text-fg-muted">{board.description}</p>
      ) : canManage ? (
        <button
          type="button"
          className="w-fit text-start text-sm text-fg-subtle hover:text-fg-muted"
          onClick={() => {
            setDraft('');
            setEditing(true);
          }}
        >
          {t('descriptionPlaceholder')}
        </button>
      ) : null}
    </header>
  );
}
