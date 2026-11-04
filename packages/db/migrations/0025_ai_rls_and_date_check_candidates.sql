-- CUBE TRACK — 0025 RLS/updated_at das tabelas de IA (ADR 0055) e candidatos para a varredura diária
-- de agentes com gatilho `date_arrives` (job de manutenção `ai-agents-date-check`, mesmo padrão de
-- `app.date_arrives_candidates()`/`app.contract_alert_candidates()`).

SELECT app.enable_tenant_rls('public.ai_settings');
--> statement-breakpoint
CREATE TRIGGER ai_settings_set_updated_at BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.ai_usage_logs');
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.ai_agents');
--> statement-breakpoint
CREATE TRIGGER ai_agents_set_updated_at BEFORE UPDATE ON public.ai_agents
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.ai_agent_runs');
--> statement-breakpoint
CREATE TRIGGER ai_agent_runs_set_updated_at BEFORE UPDATE ON public.ai_agent_runs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- O papel da aplicação não lista tenants/agentes entre tenants (RLS): a função expõe apenas os pares
-- necessários para o worker avaliar o gatilho `date_arrives` de cada agente ativo, sem outros dados de
-- negócio (mesmo padrão de app.date_arrives_candidates()/app.portfolio_health_candidates()). A
-- avaliação do item/data em si é feita pelo worker em TypeScript (dateArrivesMatches, packages/shared).
CREATE OR REPLACE FUNCTION app.ai_agent_date_check_candidates()
RETURNS TABLE (
  tenant_id uuid,
  agent_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT a.tenant_id, a.id
  FROM public.ai_agents a
  WHERE a.is_active = true
    AND a.deleted_at IS NULL
    AND (a.trigger ->> 'type') = 'date_arrives';
$$;
--> statement-breakpoint
ALTER FUNCTION app.ai_agent_date_check_candidates() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.ai_agent_date_check_candidates() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.ai_agent_date_check_candidates() TO app_rw;
