'use client';

import {
  AvatarGroup,
  Dialog,
  Drawer,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@cube-track/ui';
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  History,
  Link as LinkIcon,
  MessageSquare,
  Paperclip,
  ShieldCheck,
  Star,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import type { BoardDetail } from '@/lib/api/types';
import { useItemRealtime } from '@/realtime/provider';

import { useMarkSeen } from '../table/hooks';
import { ActivityTab } from './activity-tab';
import { ApprovalsTab } from './approvals-tab';
import { ChecklistTab } from './checklist-tab';
import { DependenciesTab } from './dependencies-tab';
import { FieldsTab } from './fields-tab';
import { FilesTab } from './files-tab';
import { useFollowStatus, useItemDetail, useSetFollowing } from './hooks';
import { neighborsOf, useItemPanelOrder } from './item-panel-store';
import { useItemPresence } from './item-presence';
import { UpdatesTab } from './updates-tab';

type ItemPanelTab =
  | 'updates'
  | 'files'
  | 'activity'
  | 'fields'
  | 'checklist'
  | 'dependencies'
  | 'approvals';

/** Painel de detalhe do item: drawer com URL própria (`?item=<id>`), abas e navegação anterior/próximo. */
export function ItemPanel({ board }: { board: BoardDetail }) {
  const t = useTranslations('itemPanel');
  const tc = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const itemId = useSearchParams().get('item');
  const [tab, setTab] = useState<ItemPanelTab>('updates');
  // Volta para a primeira aba ao trocar de item — ajuste de estado durante a renderização.
  const [tabForItem, setTabForItem] = useState(itemId);
  if (itemId !== tabForItem) {
    setTabForItem(itemId);
    setTab('updates');
  }

  useItemRealtime(itemId);
  const detail = useItemDetail(itemId);
  const order = useItemPanelOrder(board.id);
  const { prev, next } = itemId === null ? { prev: null, next: null } : neighborsOf(order, itemId);

  const close = () => {
    router.replace(pathname, { scroll: false });
  };
  const goTo = (id: string) => {
    router.replace(`${pathname}?item=${id}`, { scroll: false });
  };

  if (itemId === null) return null;
  const item = detail.data;
  const canUpdate = board.permissions.includes('item.update');
  const canComment = board.permissions.includes('item.comment') || canUpdate;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Drawer
        title={item === undefined ? <Skeleton className="h-5 w-40" /> : item.name}
        description={board.name}
        closeLabel={tc('close')}
        className="max-w-none sm:max-w-3xl"
      >
        <div className="-mt-2 mb-3 flex flex-wrap items-center gap-1 border-b border-border pb-3">
          <IconButton
            label={t('nav.prev')}
            icon={<ChevronUp aria-hidden="true" />}
            size="icon-sm"
            variant="ghost"
            disabled={prev === null}
            onClick={() => {
              if (prev !== null) goTo(prev);
            }}
          />
          <IconButton
            label={t('nav.next')}
            icon={<ChevronDown aria-hidden="true" />}
            size="icon-sm"
            variant="ghost"
            disabled={next === null}
            onClick={() => {
              if (next !== null) goTo(next);
            }}
          />
          <PresenceRow itemId={itemId} />
          <div className="ms-auto flex items-center gap-2">
            <FollowControl itemId={itemId} />
          </div>
        </div>

        {detail.isError ? (
          <p className="px-1 py-6 text-sm text-fg-muted">{tc('pageNotFoundDescription')}</p>
        ) : (
          <Tabs value={tab} onValueChange={(value) => { setTab(value as ItemPanelTab); }}>
            <TabsList className="flex-wrap">
              <TabsTrigger value="updates">
                <MessageSquare aria-hidden="true" />
                {t('tabs.updates')}
                {(item?.indicators?.unreadUpdates ?? 0) > 0 ? (
                  <span className="ms-1 inline-flex size-1.5 rounded-full bg-danger" aria-hidden="true" />
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="files">
                <Paperclip aria-hidden="true" />
                {t('tabs.files')}
              </TabsTrigger>
              <TabsTrigger value="activity">
                <History aria-hidden="true" />
                {t('tabs.activity')}
              </TabsTrigger>
              <TabsTrigger value="fields">
                <FileText aria-hidden="true" />
                {t('tabs.fields')}
              </TabsTrigger>
              <TabsTrigger value="checklist">
                <ClipboardList aria-hidden="true" />
                {t('tabs.checklist')}
              </TabsTrigger>
              <TabsTrigger value="dependencies">
                <LinkIcon aria-hidden="true" />
                {t('tabs.dependencies')}
              </TabsTrigger>
              <TabsTrigger value="approvals">
                <ShieldCheck aria-hidden="true" />
                {t('tabs.approvals')}
              </TabsTrigger>
            </TabsList>
            {item === undefined ? (
              <div className="flex flex-col gap-2 pt-4" aria-busy="true">
                <Skeleton className="h-6" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <>
                <TabsContent value="updates">
                  <UpdatesTab board={board} item={item} canComment={canComment} canModerate={canUpdate} />
                </TabsContent>
                <TabsContent value="files">
                  <FilesTab board={board} item={item} canManage={canUpdate} />
                </TabsContent>
                <TabsContent value="activity">
                  <ActivityTab board={board} item={item} />
                </TabsContent>
                <TabsContent value="fields">
                  <FieldsTab board={board} item={item} />
                </TabsContent>
                <TabsContent value="checklist">
                  <ChecklistTab item={item} canManage={canUpdate} />
                </TabsContent>
                <TabsContent value="dependencies">
                  <DependenciesTab board={board} item={item} />
                </TabsContent>
                <TabsContent value="approvals">
                  <ApprovalsTab item={item} canRequest={canUpdate} />
                </TabsContent>
              </>
            )}
          </Tabs>
        )}
      </Drawer>
      {item === undefined ? null : <MarkSeen boardId={board.id} itemId={item.id} />}
    </Dialog>
  );
}

/** Marca o item como lido ao abrir o painel (zera o indicador de atualizações não lidas). */
function MarkSeen({ boardId, itemId }: { boardId: string; itemId: string }) {
  const mark = useMarkSeen(boardId);
  const mutate = mark.mutate;
  useEffect(() => {
    mutate(itemId);
  }, [mutate, itemId]);
  return null;
}

function PresenceRow({ itemId }: { itemId: string }) {
  const t = useTranslations('itemPanel');
  const present = useItemPresence(itemId);
  if (present.length === 0) return null;
  return (
    <AvatarGroup
      people={present}
      max={4}
      ring
      label={t('presence', { count: present.length })}
      overflowLabel={(count) => t('presenceMore', { count })}
      className="ms-1"
    />
  );
}

function FollowControl({ itemId }: { itemId: string }) {
  const t = useTranslations('itemPanel');
  const status = useFollowStatus(itemId);
  const setFollowing = useSetFollowing(itemId);
  const following = status.data?.following ?? false;
  const followers = status.data?.followers ?? [];
  return (
    <Popover>
      <div className="flex items-center gap-1">
        <IconButton
          label={following ? t('follow.stop') : t('follow.start')}
          icon={<Star aria-hidden="true" className={cn(following && 'fill-warning text-warning')} />}
          size="icon-sm"
          variant="ghost"
          onClick={() => {
            void setFollowing(!following);
          }}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-fg-muted hover:bg-surface-hover"
          >
            <Users className="size-3.5" aria-hidden="true" />
            {followers.length}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent aria-label={t('follow.followers')}>
        <p className="mb-2 text-xs font-semibold text-fg-muted">{t('follow.followers')}</p>
        {followers.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('follow.none')}</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {followers.map((follower) => (
              <li key={follower.id} className="flex items-center gap-2 px-1 py-1 text-sm">
                <span className="truncate">{follower.name}</span>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
