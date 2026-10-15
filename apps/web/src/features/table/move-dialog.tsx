'use client';

import { isMappableTarget, suggestColumnMapping } from '@cube-track/shared';
import { Button, Field, Modal, Select, Skeleton } from '@cube-track/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { api } from '@/lib/api/client';
import type { BoardDetail } from '@/lib/api/types';
import { qk } from '@/lib/query/keys';

import { useGroupMutations, useItemActions, useWorkspaceBoards } from './hooks';

export type MoveTarget =
  | { type: 'items'; itemIds: string[] }
  | { type: 'group'; groupId: string; name: string };

/**
 * Mover itens ou um grupo para outro board, com mapeamento de colunas sugerido (mesma chave ou
 * título e tipo compatível). Valores sem destino são descartados; rótulos e opções viajam pelo
 * texto (ADR 0041).
 */
export function MoveDialog({
  board,
  target,
  onClose,
}: {
  board: BoardDetail;
  target: MoveTarget;
  onClose: () => void;
}) {
  const t = useTranslations('table.move');
  const tc = useTranslations('common');
  const boards = useWorkspaceBoards(board.workspaceId, true);
  const actions = useItemActions(board);
  const groups = useGroupMutations(board.id);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [chosenGroupId, setGroupId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const destination = useQuery({
    queryKey: qk.boardDetail(boardId ?? 'none'),
    queryFn: () => api<BoardDetail>(`/v1/boards/${boardId ?? ''}`),
    enabled: boardId !== null,
  });
  const sources = useMemo(
    () => board.columns.filter((column) => column.binding === null && column.type !== 'button'),
    [board.columns],
  );

  const suggested = useMemo(
    () =>
      destination.data === undefined ? {} : suggestColumnMapping(sources, destination.data.columns),
    [destination.data, sources],
  );
  const mapping = { ...suggested, ...overrides };
  const groupId = chosenGroupId ?? destination.data?.groups[0]?.id ?? null;

  const candidates = (boards.data ?? []).filter((entry) => entry.id !== board.id);
  const targetOptions = [
    { value: 'none', label: t('discard') },
    ...(destination.data?.columns ?? [])
      .filter((column) => isMappableTarget(column))
      .map((column) => ({ value: column.key, label: column.title })),
  ];

  const submit = async () => {
    if (boardId === null) return;
    setBusy(true);
    try {
      if (target.type === 'items') {
        if (groupId === null) return;
        const moved = await actions({
          action: 'move',
          itemIds: target.itemIds,
          target: { boardId, groupId, columnMapping: mapping },
        });
        if (moved !== null) onClose();
      } else {
        await groups.move.mutateAsync({
          groupId: target.groupId,
          targetBoardId: boardId,
          columnMapping: mapping,
        });
        onClose();
      }
    } catch {
      // Erro exibido pela mutação.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        target.type === 'items'
          ? t('itemsTitle', { count: target.itemIds.length })
          : t('groupTitle', { name: target.name })
      }
      description={t('description')}
      closeLabel={tc('close')}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            disabled={
              boardId === null ||
              destination.data === undefined ||
              (target.type === 'items' && groupId === null)
            }
            loading={busy}
            onClick={() => void submit()}
          >
            {t('move')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('board')}>
            <Select
              placeholder={t('pickBoard')}
              {...(boardId === null ? {} : { value: boardId })}
              options={candidates.map((entry) => ({ value: entry.id, label: entry.name }))}
              onValueChange={(value) => {
                setBoardId(value);
                setGroupId(null);
                setOverrides({});
              }}
            />
          </Field>
          {target.type === 'items' && destination.data !== undefined ? (
            <Field label={t('group')}>
              <Select
                {...(groupId === null ? {} : { value: groupId })}
                options={destination.data.groups.map((group) => ({
                  value: group.id,
                  label: group.name,
                }))}
                onValueChange={setGroupId}
              />
            </Field>
          ) : null}
        </div>
        {boardId !== null && destination.isPending ? <Skeleton className="h-24" /> : null}
        {destination.data === undefined ? null : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('mapping')}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-sunken">
                  <th scope="col" className="px-2 py-1.5 text-start">
                    {t('from', { board: board.name })}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start">
                    {t('to', { board: destination.data.name })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((column) => (
                  <tr key={column.key} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-2 py-1.5 text-start font-medium">
                      {column.title}
                    </th>
                    <td className="px-2 py-1.5">
                      <Select
                        className="h-8"
                        aria-label={t('targetFor', { column: column.title })}
                        value={mapping[column.key] ?? 'none'}
                        options={targetOptions}
                        onValueChange={(value) => {
                          setOverrides((current) => ({
                            ...current,
                            [column.key]: value === 'none' ? null : value,
                          }));
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
