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
  ClipboardList,
  Copy,
  Link2,
  MoreHorizontal,
  Pencil,
  Plug,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  UserPlus,
  Workflow,
  Zap,
  LayoutTemplate,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';
import type { BoardDetail } from '@/lib/api/types';
import { openDialog } from '@/stores/shell';
import { useSession } from '@/stores/session';

import { AiDialog } from '../ai/ai-dialog';
import { AutomationsDialog } from '../automations/automations-dialog';
import { ServiceOrdersDialog } from '../contracts/service-orders-dialog';
import { GovernanceDialog } from '../governance/governance-dialog';
import { ImportWizardDialog } from '../imports/import-wizard-dialog';
import { ProcessSettingsDialog } from '../processes/process-settings-dialog';
import { SaveAsTemplateDialog } from '../templates/save-as-template-dialog';
import {
  useDeleteBoard,
  useDuplicateBoard,
  useFavorites,
  useToggleFavorite,
  useWorkspaces,
} from '../workspace/hooks';
import { WebhooksDialog } from '../webhooks/webhooks-dialog';
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
  const router = useRouter();
  const favorites = useFavorites();
  const toggleFavorite = useToggleFavorite();
  const duplicateBoard = useDuplicateBoard(board.workspaceId);
  const deleteBoard = useDeleteBoard(board.workspaceId);
  const update = useUpdateBoardDetails(board.id);
  const canManage = board.permissions.includes('board.manage');
  const canAutomate = board.permissions.includes('automation.manage');
  const canManageProcess = board.kind === 'process' && board.permissions.includes('process.manage');
  const canManageWebhooks = board.permissions.includes('webhook.manage');
  const canSaveAsTemplate = board.permissions.includes('board.manage');
  const canImport = board.permissions.includes('item.create');
  const canGovernance = board.kind === 'project';
  const canServiceOrders = board.contractId !== null;
  const canInvite = useSession((state) => state.tenant !== null);
  const workspaces = useWorkspaces();
  const aiModuleEnabled =
    (workspaces.data ?? []).find((entry) => entry.id === board.workspaceId)?.enabledModules.includes('ai') ===
    true;
  const canAi =
    aiModuleEnabled &&
    (board.permissions.includes('ai.use') ||
      board.permissions.includes('ai.agents.manage') ||
      board.permissions.includes('ai.agents.approve'));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board.description ?? '');
  const [dialog, setDialog] = useState<
    | 'invite'
    | 'share'
    | 'automate'
    | 'process'
    | 'webhooks'
    | 'governance'
    | 'serviceOrders'
    | 'ai'
    | 'saveAsTemplate'
    | 'import'
    | null
  >(null);
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
            <DropdownMenuItem
              icon={<Copy aria-hidden="true" />}
              onSelect={() => {
                duplicateBoard.mutate(
                  { boardId: board.id },
                  {
                    onSuccess: (created) => {
                      router.push(`/w/${board.workspaceId}/b/${created.id}`);
                    },
                  },
                );
              }}
            >
              {t('duplicateBoard')}
            </DropdownMenuItem>
            {canManage ? (
              <DropdownMenuItem
                destructive
                icon={<Trash2 aria-hidden="true" />}
                onSelect={() => {
                  if (window.confirm(t('deleteBoardConfirm', { name: board.name })))
                    deleteBoard.mutate(board.id, {
                      onSuccess: () => {
                        router.push(`/w/${board.workspaceId}`);
                      },
                    });
                }}
              >
                {t('deleteBoard')}
              </DropdownMenuItem>
            ) : null}
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
            {dialog === 'automate' && canAutomate ? <AutomationsDialog board={board} /> : null}
            {canAutomate ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('automate');
                  }}
                >
                  <Zap aria-hidden="true" />
                  <span className="hidden xl:inline">{t('automate')}</span>
                  <span className="sr-only xl:hidden">{t('automate')}</span>
                </Button>
              </DialogTrigger>
            ) : (
              <ModuleButton icon={<Zap aria-hidden="true" />} label={t('automate')} hint={t('featureLater')} />
            )}
            {dialog === 'process' && canManageProcess ? (
              <ProcessSettingsDialog board={board} />
            ) : null}
            {canManageProcess ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('process');
                  }}
                >
                  <Workflow aria-hidden="true" />
                  <span className="hidden xl:inline">{t('process')}</span>
                  <span className="sr-only xl:hidden">{t('process')}</span>
                </Button>
              </DialogTrigger>
            ) : null}
            {dialog === 'webhooks' && canManageWebhooks ? <WebhooksDialog board={board} /> : null}
            {canManageWebhooks ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('webhooks');
                  }}
                >
                  <Plug aria-hidden="true" />
                  <span className="hidden xl:inline">{t('integrate')}</span>
                  <span className="sr-only xl:hidden">{t('integrate')}</span>
                </Button>
              </DialogTrigger>
            ) : (
              <ModuleButton icon={<Plug aria-hidden="true" />} label={t('integrate')} hint={t('featureLater')} />
            )}
            {dialog === 'governance' && canGovernance ? <GovernanceDialog board={board} /> : null}
            {canGovernance ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('governance');
                  }}
                >
                  <ShieldCheck aria-hidden="true" />
                  <span className="hidden xl:inline">{t('governance')}</span>
                  <span className="sr-only xl:hidden">{t('governance')}</span>
                </Button>
              </DialogTrigger>
            ) : null}
            {dialog === 'serviceOrders' && canServiceOrders ? <ServiceOrdersDialog board={board} /> : null}
            {canServiceOrders ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('serviceOrders');
                  }}
                >
                  <ClipboardList aria-hidden="true" />
                  <span className="hidden xl:inline">{t('serviceOrders')}</span>
                  <span className="sr-only xl:hidden">{t('serviceOrders')}</span>
                </Button>
              </DialogTrigger>
            ) : null}
            {dialog === 'ai' && canAi ? <AiDialog board={board} /> : null}
            {canAi ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('ai');
                  }}
                >
                  <Bot aria-hidden="true" />
                  <span className="hidden xl:inline">{t('ai')}</span>
                  <span className="sr-only xl:hidden">{t('ai')}</span>
                </Button>
              </DialogTrigger>
            ) : null}
            {dialog === 'saveAsTemplate' && canSaveAsTemplate ? (
              <SaveAsTemplateDialog
                boardId={board.id}
                onDone={() => {
                  setDialog(null);
                }}
              />
            ) : null}
            {canSaveAsTemplate ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('saveAsTemplate');
                  }}
                >
                  <LayoutTemplate aria-hidden="true" />
                  <span className="hidden xl:inline">{t('saveAsTemplate')}</span>
                  <span className="sr-only xl:hidden">{t('saveAsTemplate')}</span>
                </Button>
              </DialogTrigger>
            ) : null}
            {dialog === 'import' && canImport ? (
              <ImportWizardDialog
                board={board}
                onDone={() => {
                  setDialog(null);
                }}
              />
            ) : null}
            {canImport ? (
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDialog('import');
                  }}
                >
                  <Upload aria-hidden="true" />
                  <span className="hidden xl:inline">{t('import')}</span>
                  <span className="sr-only xl:hidden">{t('import')}</span>
                </Button>
              </DialogTrigger>
            ) : null}
          </Dialog>
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
