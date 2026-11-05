-- CUBE TRACK — 0031: RLS/updated_at de `integration_apps` (Prompt 15, parte 3: Google/Microsoft,
-- Slack/Teams, GitHub/GitLab/Azure DevOps, ADR 0056) e função de resolução de `integration_connections`
-- por id SEM contexto de tenant — os webhooks de entrada (GitHub/GitLab/Azure DevOps/Slack) e o
-- callback OAuth (Google/Microsoft) recebem só um id de conexão na URL/estado, nenhuma sessão: mesmo
-- padrão de `app.resolve_oauth_app` (0029) — função SECURITY DEFINER, executada pela conexão de
-- negócio (`app_rw`), sem GRANT adicional.

SELECT app.enable_tenant_rls('public.integration_apps');
--> statement-breakpoint
CREATE TRIGGER integration_apps_set_updated_at BEFORE UPDATE ON public.integration_apps
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.resolve_integration_connection(p_connection_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  id uuid,
  workspace_id uuid,
  provider text,
  auth_kind text,
  user_id uuid,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  webhook_secret_ciphertext text,
  outbound_webhook_url_ciphertext text,
  metadata jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT
    c.tenant_id, c.id, c.workspace_id, c.provider::text, c.auth_kind::text, c.user_id,
    c.access_token_ciphertext, c.refresh_token_ciphertext, c.token_expires_at,
    c.webhook_secret_ciphertext, c.outbound_webhook_url_ciphertext, c.metadata
  FROM public.integration_connections c
  JOIN public.tenants t ON t.id = c.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
  WHERE c.id = p_connection_id AND c.is_active AND c.deleted_at IS NULL;
$$;
--> statement-breakpoint
ALTER FUNCTION app.resolve_integration_connection(uuid) OWNER TO platform_admin;
