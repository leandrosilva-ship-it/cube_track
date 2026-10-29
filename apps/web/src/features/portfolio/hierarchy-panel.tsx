'use client';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, EmptyState, IconButton, Skeleton, toast } from '@cube-track/ui';
import { Briefcase, FolderKanban, MoreVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useErrorMessage } from '@/lib/errors/use-error-message';
import type { Portfolio, Program } from '@/lib/api/types';

import { useDeletePortfolio, useDeleteProgram, usePortfolioRollup, usePortfolios, useProgramRollup, usePrograms, useScoringModels } from './model';
import { PortfolioDialog } from './portfolio-dialog';
import { ProgramDialog } from './program-dialog';
import { RollupCard } from './rollup-card';

export interface HierarchyPanelProps {
  workspaceId: string;
  canManage: boolean;
}

function ProgramRow({
  program,
  canManage,
  onEdit,
  onDelete,
}: {
  program: Program;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('portfolio');
  const rollup = useProgramRollup(program.id);
  return (
    <li className="rounded-lg border border-border-subtle bg-surface-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderKanban className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="font-medium">{program.name}</span>
        </div>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" variant="ghost" label={t('portfolios.editProgramTitle')} icon={<MoreVertical className="size-4" aria-hidden="true" />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Pencil className="size-4" aria-hidden="true" />} onSelect={onEdit}>
                {t('portfolios.editProgramTitle')}
              </DropdownMenuItem>
              <DropdownMenuItem destructive icon={<Trash2 className="size-4" aria-hidden="true" />} onSelect={onDelete}>
                {t('portfolios.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {rollup.data === undefined ? <Skeleton className="mt-2 h-10" /> : <div className="mt-2"><RollupCard rollup={rollup.data} compact /></div>}
    </li>
  );
}

function PortfolioCard({
  portfolio,
  programs,
  canManage,
  onEditPortfolio,
  onDeletePortfolio,
  onNewProgram,
  onEditProgram,
  onDeleteProgram,
}: {
  portfolio: Portfolio;
  programs: Program[];
  canManage: boolean;
  onEditPortfolio: () => void;
  onDeletePortfolio: () => void;
  onNewProgram: () => void;
  onEditProgram: (program: Program) => void;
  onDeleteProgram: (id: string) => void;
}) {
  const t = useTranslations('portfolio');
  const rollup = usePortfolioRollup(portfolio.id);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Briefcase className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h3 className="font-semibold">{portfolio.name}</h3>
            {portfolio.description !== null && portfolio.description !== '' ? (
              <p className="text-sm text-fg-muted">{portfolio.description}</p>
            ) : null}
          </div>
        </div>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" variant="ghost" label={t('portfolios.editTitle')} icon={<MoreVertical className="size-4" aria-hidden="true" />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Pencil className="size-4" aria-hidden="true" />} onSelect={onEditPortfolio}>
                {t('portfolios.editTitle')}
              </DropdownMenuItem>
              <DropdownMenuItem destructive icon={<Trash2 className="size-4" aria-hidden="true" />} onSelect={onDeletePortfolio}>
                {t('portfolios.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {rollup.data === undefined ? <Skeleton className="h-14" /> : <RollupCard rollup={rollup.data} />}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-fg-muted">{t('portfolios.programs')}</h4>
        {canManage ? (
          <Button size="sm" variant="ghost" onClick={onNewProgram}>
            <Plus className="size-4" aria-hidden="true" />
            {t('portfolios.newProgram')}
          </Button>
        ) : null}
      </div>
      {programs.length === 0 ? (
        <p className="text-sm text-fg-subtle">{t('portfolios.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {programs.map((program) => (
            <ProgramRow
              key={program.id}
              program={program}
              canManage={canManage}
              onEdit={() => { onEditProgram(program); }}
              onDelete={() => { onDeleteProgram(program.id); }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Hierarquia Portfólio → Programa → Projeto (ADR 0053): cada card busca seu próprio rollup. */
export function HierarchyPanel({ workspaceId, canManage }: HierarchyPanelProps) {
  const t = useTranslations('portfolio');
  const errorMessage = useErrorMessage();
  const portfolios = usePortfolios(workspaceId);
  const programs = usePrograms(workspaceId);
  const scoringModels = useScoringModels();
  const deletePortfolio = useDeletePortfolio(workspaceId);
  const deleteProgram = useDeleteProgram(workspaceId);

  const [portfolioDialog, setPortfolioDialog] = useState<'new' | Portfolio | null>(null);
  const [programDialog, setProgramDialog] = useState<{ portfolioId: string | null; program?: Program } | null>(null);

  if (portfolios.data === undefined || programs.data === undefined) return <Skeleton className="h-48" />;

  const unassignedPrograms = programs.data.filter((program) => program.portfolioId === null);

  const removePortfolio = async (id: string) => {
    if (!window.confirm(t('portfolios.deleteConfirm'))) return;
    try {
      await deletePortfolio.mutateAsync(id);
      toast.success(t('portfolios.deleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeProgram = async (id: string) => {
    try {
      await deleteProgram.mutateAsync(id);
      toast.success(t('portfolios.programDeleted'));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setProgramDialog({ portfolioId: null });
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('portfolios.newProgram')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setPortfolioDialog('new');
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('portfolios.new')}
          </Button>
        </div>
      ) : null}

      {portfolios.data.length === 0 && unassignedPrograms.length === 0 ? (
        <EmptyState icon={<Briefcase aria-hidden="true" />} title={t('portfolios.empty')} />
      ) : null}

      {portfolios.data.map((portfolio) => (
        <PortfolioCard
          key={portfolio.id}
          portfolio={portfolio}
          programs={programs.data.filter((program) => program.portfolioId === portfolio.id)}
          canManage={canManage}
          onEditPortfolio={() => { setPortfolioDialog(portfolio); }}
          onDeletePortfolio={() => void removePortfolio(portfolio.id)}
          onNewProgram={() => { setProgramDialog({ portfolioId: portfolio.id }); }}
          onEditProgram={(program) => { setProgramDialog({ portfolioId: portfolio.id, program }); }}
          onDeleteProgram={(id) => void removeProgram(id)}
        />
      ))}

      {unassignedPrograms.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4">
          <h4 className="text-sm font-medium text-fg-muted">{t('portfolios.unassignedPrograms')}</h4>
          <ul className="flex flex-col gap-2">
            {unassignedPrograms.map((program) => (
              <ProgramRow
                key={program.id}
                program={program}
                canManage={canManage}
                onEdit={() => { setProgramDialog({ portfolioId: null, program }); }}
                onDelete={() => void removeProgram(program.id)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {portfolioDialog !== null ? (
        <PortfolioDialog
          workspaceId={workspaceId}
          scoringModels={scoringModels.data ?? []}
          {...(portfolioDialog !== 'new' ? { portfolio: portfolioDialog } : {})}
          onClose={() => { setPortfolioDialog(null); }}
        />
      ) : null}

      {programDialog !== null ? (
        <ProgramDialog
          workspaceId={workspaceId}
          portfolios={portfolios.data}
          defaultPortfolioId={programDialog.portfolioId}
          {...(programDialog.program !== undefined ? { program: programDialog.program } : {})}
          onClose={() => { setProgramDialog(null); }}
        />
      ) : null}
    </div>
  );
}
