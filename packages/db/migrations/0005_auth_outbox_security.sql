-- CUBE TRACK — 0005 papéis de autenticação e relay, RLS de outbox e tabelas de identidade.
-- ADRs: 0026 (autenticação nativa), 0027 (outbox como log de replay), 0028 (papéis app_auth/app_relay).

DO $$
BEGIN
  -- app_auth: fluxos de autenticação antes do contexto de tenant (login, refresh, convites).
  -- app_relay: relay do outbox (lê eventos de todos os tenants e marca como publicados).
  -- Sem BYPASSRLS (atributo não é herdado por membros): o acesso vem de políticas `TO <papel>`
  -- restritas às tabelas necessárias, abaixo.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    CREATE ROLE app_auth NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_relay') THEN
    CREATE ROLE app_relay NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public, app TO app_auth, app_relay;
--> statement-breakpoint

-- updated_at nas novas tabelas
CREATE TRIGGER user_identities_set_updated_at BEFORE UPDATE ON public.user_identities
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER auth_tokens_set_updated_at BEFORE UPDATE ON public.auth_tokens
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Outbox: isolamento por tenant; a aplicação insere e lê (replay), nunca altera.
SELECT app.enable_tenant_rls('public.outbox_events');
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON public.outbox_events FROM app_rw, platform_admin;
--> statement-breakpoint
GRANT SELECT, UPDATE (published_at), DELETE ON public.outbox_events TO app_relay;
--> statement-breakpoint

-- Identidades externas e tokens de uso único: sem acesso para os papéis de negócio.
ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.user_identities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.auth_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.auth_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.user_identities, public.auth_tokens FROM app_rw, app_ro, platform_admin;
--> statement-breakpoint

-- Privilégios mínimos do papel de autenticação.
GRANT SELECT, INSERT, UPDATE ON public.users TO app_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_identities, public.auth_tokens, public.sessions TO app_auth;
--> statement-breakpoint
GRANT SELECT ON public.memberships, public.tenants, public.roles TO app_auth;
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.invitations TO app_auth;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.current_tenant_id(), app.current_user_id(), app.set_context(uuid, uuid)
  TO app_auth, app_relay;
--> statement-breakpoint
-- Políticas específicas por papel (aplicam-se aos membros do papel; nenhum outro papel é afetado).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'user_identities', 'auth_tokens', 'sessions', 'memberships', 'tenants', 'roles', 'invitations'] LOOP
    EXECUTE format('CREATE POLICY auth_service ON public.%I AS PERMISSIVE FOR ALL TO app_auth USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE POLICY relay_service ON public.outbox_events AS PERMISSIVE FOR ALL TO app_relay USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Resolução de tenant por slug ou id (subdomínio/header) antes do contexto.
CREATE OR REPLACE FUNCTION app.resolve_tenant(p_ref text)
RETURNS TABLE (tenant_id uuid, slug text, name text, status public.tenant_status)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT t.id, t.slug, t.name, t.status
  FROM public.tenants t
  WHERE t.deleted_at IS NULL
    -- Comparação textual: o SQL não garante curto-circuito, então não há cast de p_ref para uuid.
    AND (t.slug = lower(p_ref) OR t.id::text = lower(p_ref));
$$;
--> statement-breakpoint
ALTER FUNCTION app.resolve_tenant(text) OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.resolve_tenant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_tenant(text) TO app_rw, app_auth;
