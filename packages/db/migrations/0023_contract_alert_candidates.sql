-- CUBE TRACK — 0023 candidatos para o alerta diário de contratos (ADR 0054). O papel da aplicação
-- não lista tenants/contratos entre tenants (RLS): a função expõe apenas os pares necessários para
-- o worker avaliar os alertas (saldo baixo, vigência, OS sem emissão), sem outros dados de negócio
-- (mesmo padrão de app.sla_tracker_alerts()/app.portfolio_health_candidates()). A avaliação em si
-- (que precisa somar as OS do contrato) é feita pelo worker em TypeScript com o motor de
-- packages/shared/src/contracts.ts, não aqui — a função só filtra "quais contratos olhar".
CREATE OR REPLACE FUNCTION app.contract_alert_candidates()
RETURNS TABLE (
  tenant_id uuid,
  contract_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT c.tenant_id, c.id
  FROM public.contracts c
  WHERE c.status = 'active'
    AND c.deleted_at IS NULL;
$$;
--> statement-breakpoint
ALTER FUNCTION app.contract_alert_candidates() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.contract_alert_candidates() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.contract_alert_candidates() TO app_rw;
