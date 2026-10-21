'use client';

import { EmptyState } from '@cube-track/ui';
import { useTranslations } from 'next-intl';

import { KanbanView } from '../kanban/kanban-view';
import { TableView } from '../table/table-view';
import type { BoardDetail, BoardView } from '@/lib/api/types';

import { VIEW_ICONS } from './view-tabs';

export interface BoardViewBodyProps {
  board: BoardDetail;
  view: BoardView;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Registro de telas por tipo de view (ADR 0044). Só `table` e `kanban` têm tela própria agora —
 * os demais tipos mostram "em breve" (mesmo padrão de Integrar/Automatizar/Agentes).
 */
export function BoardViewBody({ board, view, searchRef }: BoardViewBodyProps) {
  if (view.type === 'table') return <TableView key={board.id} board={board} searchRef={searchRef} />;
  if (view.type === 'kanban') return <KanbanView key={view.id} board={board} view={view} searchRef={searchRef} />;
  return <ComingSoonView type={view.type} />;
}

function ComingSoonView({ type }: { type: BoardView['type'] }) {
  const t = useTranslations('board.views');
  const Icon = VIEW_ICONS[type];
  return (
    <div className="p-6">
      <EmptyState
        icon={<Icon aria-hidden="true" />}
        title={t(`types.${type}`)}
        description={t('comingSoon')}
      />
    </div>
  );
}
