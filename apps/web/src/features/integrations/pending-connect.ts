const STORAGE_KEY = 'ct_pending_integration_workspace';

/**
 * Lembra, só neste navegador, qual workspace iniciou um fluxo OAuth de integração (ADR 0056) — o
 * callback (`GET /v1/integrations/:provider/callback`) é um redirect público que só conhece
 * `provider`/`status`/`error` (ver `docs/adr/0056-...md`), não o workspace de origem. A página-ponte
 * `/integrations` lê este valor para devolver a pessoa à aba de integrações do workspace certo.
 * Nunca falha a navegação: `sessionStorage` pode lançar (modo privado, storage bloqueado).
 */
export function rememberPendingIntegrationWorkspace(workspaceId: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, workspaceId);
  } catch {
    // Melhor esforço — a pessoa ainda consegue voltar manualmente às configurações do workspace.
  }
}

/** Lê e apaga o workspace pendente (uso único) — `null` se nunca foi gravado ou não pôde ser lido. */
export function takePendingIntegrationWorkspace(): string | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return value;
  } catch {
    return null;
  }
}
