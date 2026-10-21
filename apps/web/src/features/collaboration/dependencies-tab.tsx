'use client';

import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import type { BoardDetail, Item } from '@/lib/api/types';

import { DependencyEditor } from '../table/dependency-editor';
import { useDependencies, useItemName } from '../table/hooks';

function SuccessorName({ id }: { id: string }) {
  const name = useItemName(id, undefined);
  return <span className="min-w-0 flex-1 truncate text-sm">{name.data ?? '…'}</span>;
}

/**
 * Aba "Dependências": reaproveita `DependencyEditor` (predecessoras, com detecção de ciclo no
 * grafo do board inteiro, já existente desde o Prompt 5) e lista as sucessoras (somente leitura —
 * editadas a partir do item predecessor). Itens relacionados (colunas de relação) ficam na aba
 * "Campos", onde já são editáveis.
 */
export function DependenciesTab({ board, item }: { board: BoardDetail; item: Item }) {
  const t = useTranslations('itemPanel');
  const tDep = useTranslations('table.dependencies');
  const dependencies = useDependencies(board.id, true);
  const successors = useMemo(
    () => (dependencies.data ?? []).filter((dependency) => dependency.predecessorId === item.id),
    [dependencies.data, item.id],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* onDone fecharia um popover; aqui a aba já é o lugar persistente, então não há o que fazer. */}
      {/* eslint-disable-next-line @typescript-eslint/no-empty-function */}
      <DependencyEditor board={board} item={item} onDone={() => {}} />
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase text-fg-subtle">{t('dependencies.successors')}</h3>
        {successors.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('dependencies.noSuccessors')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {successors.map((dependency) => (
              <li key={dependency.id} className="flex items-center gap-2">
                <SuccessorName id={dependency.successorId} />
                <span className="text-xs text-fg-subtle">{tDep(`types.${dependency.type}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
