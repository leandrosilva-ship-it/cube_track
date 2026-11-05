import { type ApiScope } from '@cube-track/shared/api-access';
import type { Action } from '@cube-track/shared';

/**
 * Mapeia cada `Action` do RBAC para o escopo de API que a autoriza (ADR 0056). Um token de API só
 * cobre os módulos do catálogo de `API_SCOPES` (`@cube-track/shared/api-access`) — ações fora daqui
 * (gestão de membros, papéis, times, IA, contratos, timesheet, portfólio…) continuam exigindo sessão
 * de login normal, mesmo que o usuário dono do token pudesse fazê-las: `null` bloqueia a ação por
 * completo para um principal autenticado por token, não a libera.
 */
const ACTION_SCOPES: Partial<Record<Action, ApiScope>> = {
  'workspace.read': 'boards:read',
  'workspace.manage': 'boards:write',
  'workspace.create': 'boards:write',
  'folder.manage': 'boards:write',
  'board.read': 'boards:read',
  'board.manage': 'boards:write',
  'board.create': 'boards:write',
  'board.share': 'boards:write',
  'board.export': 'boards:read',
  // `column.manage` é estrutural (criar/editar/excluir a DEFINIÇÃO da coluna) — igual às outras ações
  // de administração do board, exige `boards:write`. `column.read`/`column.update` (ações derivadas,
  // packages/shared/src/permissions.ts) são por ITEM — ler/escrever o VALOR de uma coluna num item —
  // por isso seguem o escopo de itens, não o de boards (senão um token só de `items:write` nunca
  // conseguiria escrever nenhuma coluna ao criar/atualizar um item).
  'column.manage': 'boards:write',
  'column.read': 'items:read',
  'column.update': 'items:write',
  'group.manage': 'boards:write',
  'view.manage': 'boards:write',
  'view.read': 'boards:read',
  'view.update': 'boards:write',
  'dashboard.create': 'boards:write',
  'dashboard.read': 'boards:read',
  'dashboard.update': 'boards:write',
  'item.read': 'items:read',
  'item.create': 'items:write',
  'item.update': 'items:write',
  'item.update_assigned': 'items:write',
  'item.delete': 'items:write',
  'item.comment': 'items:write',
  'automation.manage': 'automations:manage',
  'webhook.manage': 'webhooks:manage',
  'templates.manage': 'templates:manage',
  'file.upload': 'files:write',
};

/** `null` = ação fora do catálogo de API — nunca permitida para um principal de token, qualquer que
 * seja o escopo declarado. */
export function scopeForAction(action: Action): ApiScope | null {
  return ACTION_SCOPES[action] ?? null;
}
