-- CUBE TRACK — 0021 candidatos para o recálculo diário de saúde/RAG automático (ADR 0053). O papel
-- da aplicação não lista tenants/boards entre tenants (RLS): a função expõe apenas os pares
-- necessários para o worker recalcular, sem outros dados de negócio (mesmo padrão de
-- app.sla_tracker_alerts()).
CREATE OR REPLACE FUNCTION app.portfolio_health_candidates()
RETURNS TABLE (
  tenant_id uuid,
  board_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT b.tenant_id, b.id
  FROM public.boards b
  WHERE b.kind = 'project'
    AND b.status = 'active'
    AND b.deleted_at IS NULL
    AND b.archived_at IS NULL;
$$;
--> statement-breakpoint
ALTER FUNCTION app.portfolio_health_candidates() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.portfolio_health_candidates() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.portfolio_health_candidates() TO app_rw;
