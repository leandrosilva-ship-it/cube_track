import type { TemplateKind } from '@cube-track/shared';

/**
 * Helpers puros da galeria de templates (ADR 0056): o corpo de `POST /v1/templates/:id/apply` varia
 * por `kind` — este módulo concentra essa derivação (campos exigidos pelo formulário, montagem do
 * corpo) sem I/O, para ser testável sem rede. Ver `docs/integrations.md` §3 e
 * `apps/api/src/modules/templates/presentation/templates.controller.ts` para o contrato exato.
 */

export interface ApplyTemplateState {
  workspaceId: string;
  useNewWorkspace: boolean;
  newWorkspaceName: string;
  boardId: string;
  name: string;
  targetGroupId: string;
}

export function emptyApplyTemplateState(): ApplyTemplateState {
  return { workspaceId: '', useNewWorkspace: false, newWorkspaceName: '', boardId: '', name: '', targetGroupId: '' };
}

/** `board`/`dashboard`/`workspace` (quando aplicado a um workspace existente) exigem escolher o
 * workspace; `automation`/`form` também mostram o seletor, como pré-requisito do seletor de board
 * abaixo (o board em si não pertence ao corpo enviado para esses dois `kind`). */
export function needsWorkspacePicker(kind: TemplateKind, state: ApplyTemplateState): boolean {
  if (kind === 'board' || kind === 'dashboard' || kind === 'automation' || kind === 'form') return true;
  return !state.useNewWorkspace;
}

/** `automation`/`form` são aplicados sobre um board já existente. */
export function needsBoardPicker(kind: TemplateKind): boolean {
  return kind === 'automation' || kind === 'form';
}

/** `board`/`dashboard` aceitam um nome opcional que substitui o nome do template. */
export function allowsNameOverride(kind: TemplateKind): boolean {
  return kind === 'board' || kind === 'dashboard';
}

/** Monta o corpo de `POST /v1/templates/:id/apply` a partir do estado do formulário; `null` quando os
 * campos obrigatórios para este `kind` ainda não foram preenchidos (o chamador mantém o botão desabilitado). */
export function buildApplyBody(kind: TemplateKind, state: ApplyTemplateState): Record<string, unknown> | null {
  const trimmedName = state.name.trim();
  switch (kind) {
    case 'board':
      if (state.workspaceId === '') return null;
      return { workspaceId: state.workspaceId, ...(trimmedName === '' ? {} : { name: trimmedName }) };
    case 'dashboard':
      if (state.workspaceId === '') return null;
      return { workspaceId: state.workspaceId, ...(trimmedName === '' ? {} : { name: trimmedName }) };
    case 'workspace':
      if (state.useNewWorkspace) {
        const newName = state.newWorkspaceName.trim();
        return newName === '' ? null : { newWorkspaceName: newName };
      }
      return state.workspaceId === '' ? null : { workspaceId: state.workspaceId };
    case 'automation':
      return state.boardId === '' ? null : { boardId: state.boardId };
    case 'form':
      if (state.boardId === '') return null;
      return { boardId: state.boardId, ...(state.targetGroupId === '' ? {} : { targetGroupId: state.targetGroupId }) };
    default:
      return null;
  }
}
