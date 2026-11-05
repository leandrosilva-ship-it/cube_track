-- CUBE TRACK — 0032: candidatos para a sincronização periódica de calendário (ADR 0056). O papel da
-- aplicação não lista tenants/conexões entre tenants (RLS): a função expõe só o par necessário para o
-- worker abrir o contexto do tenant certo e então ler a conexão completa por dentro do RLS normal
-- (mesmo padrão de app.contract_alert_candidates()/app.sla_tracker_alerts()). A reconciliação em si
-- roda no worker (TypeScript), nunca aqui.

CREATE OR REPLACE FUNCTION app.active_oauth_calendar_connections()
RETURNS TABLE (
  tenant_id uuid,
  id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT c.tenant_id, c.id
  FROM public.integration_connections c
  WHERE c.provider IN ('google', 'microsoft')
    AND c.auth_kind = 'oauth'
    AND c.is_active
    AND c.deleted_at IS NULL;
$$;
--> statement-breakpoint
ALTER FUNCTION app.active_oauth_calendar_connections() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.active_oauth_calendar_connections() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.active_oauth_calendar_connections() TO app_rw;
