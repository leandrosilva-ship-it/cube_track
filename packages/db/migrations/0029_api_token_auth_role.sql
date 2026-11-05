-- CUBE TRACK — 0029: autenticação por token de API (Prompt 15, ADR 0056).
--
-- `AuthGuard` precisa resolver um `Authorization: Bearer ctk_…` consultando `api_tokens` (e, quando
-- o token é de um app OAuth, `oauth_apps`) ANTES de qualquer contexto de tenant existir — exatamente
-- o mesmo problema que `sessions`/`auth_tokens` já resolvem com o papel `app_auth` (0005): como as
-- duas tabelas têm RLS (política `tenant_isolation`, permissiva, criada em 0002/0028), basta somar
-- outra política permissiva `TO app_auth USING (true)` — políticas permissivas se combinam com OR,
-- então o papel de autenticação enxerga todas as linhas sem precisar de BYPASSRLS.

GRANT SELECT, UPDATE ON public.api_tokens TO app_auth;
--> statement-breakpoint
GRANT SELECT ON public.oauth_apps TO app_auth;
--> statement-breakpoint

CREATE POLICY auth_service ON public.api_tokens AS PERMISSIVE FOR ALL TO app_auth USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_service ON public.oauth_apps AS PERMISSIVE FOR ALL TO app_auth USING (true) WITH CHECK (true);
--> statement-breakpoint

-- `POST /v1/oauth/token` (client_credentials, público) recebe só um `client_id` — sem tenant conhecido
-- ainda — e precisa achar o app antes de abrir a transação normal com contexto de tenant (que então
-- grava o novo `api_tokens` pelo papel de negócio de sempre). Mesmo padrão de `app.resolve_public_form`
-- (0002): função SECURITY DEFINER, executada pela conexão de negócio (`app_rw`), sem GRANT adicional
-- (EXECUTE de função é PUBLIC por padrão, como as demais funções de resolução deste arquivo).
CREATE OR REPLACE FUNCTION app.resolve_oauth_app(p_client_id text)
RETURNS TABLE (tenant_id uuid, id uuid, client_secret_ciphertext text, scopes text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT a.tenant_id, a.id, a.client_secret_ciphertext, a.scopes
  FROM public.oauth_apps a
  JOIN public.tenants t ON t.id = a.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
  WHERE a.client_id = p_client_id AND a.is_active AND a.deleted_at IS NULL;
$$;
--> statement-breakpoint
ALTER FUNCTION app.resolve_oauth_app(text) OWNER TO platform_admin;
