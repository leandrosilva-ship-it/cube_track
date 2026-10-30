import type { OptionalWorkspaceModule } from '@cube-track/shared';
import { hasModule } from '@cube-track/shared';

import { NotFoundError } from '../errors/problems.js';

/**
 * Módulos opcionais por workspace (ADR 0017/ADR 0054): quando desativado, a rota se comporta como
 * se não existisse — 404, não 403/422 — mesma decisão já registrada na ADR 0017 ("módulos
 * desativados ficam invisíveis na UI e suas rotas retornam 404"). Chamado no início de todo método
 * do módulo Contratos (leitura e escrita), depois de resolver o `enabledModules` do workspace dono
 * do recurso.
 */
export function assertModuleEnabled(enabledModules: readonly string[], module: OptionalWorkspaceModule): void {
  if (!hasModule(enabledModules, module)) {
    throw new NotFoundError('Recurso', `${module}_module_disabled`);
  }
}
