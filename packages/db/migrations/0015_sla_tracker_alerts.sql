-- CUBE TRACK — 0015 candidatos de aviso/violação de SLA para a verificação periódica do worker
-- (ADR 0051). O papel da aplicação não lista tenants/trackers entre tenants (RLS): a função expõe
-- apenas os trios necessários para o worker emitir o alerta, sem outros dados de negócio.
CREATE OR REPLACE FUNCTION app.sla_tracker_alerts()
RETURNS TABLE (
  tenant_id uuid,
  tracker_id uuid,
  sla_id uuid,
  item_id uuid,
  board_id uuid,
  kind text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT st.tenant_id, st.id, st.sla_id, st.item_id, s.board_id, 'breached'
  FROM public.sla_trackers st
  JOIN public.slas s ON s.id = st.sla_id
  WHERE st.status = 'running'
    AND st.due_at <= now()
  UNION ALL
  SELECT st.tenant_id, st.id, st.sla_id, st.item_id, s.board_id, 'warning'
  FROM public.sla_trackers st
  JOIN public.slas s ON s.id = st.sla_id
  WHERE st.status = 'running'
    AND st.warning_at IS NOT NULL
    AND st.warning_at <= now()
    AND st.due_at > now()
    AND NOT EXISTS (
      SELECT 1 FROM public.sla_events se WHERE se.tracker_id = st.id AND se.type = 'warning'
    );
$$;
--> statement-breakpoint
ALTER FUNCTION app.sla_tracker_alerts() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.sla_tracker_alerts() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.sla_tracker_alerts() TO app_rw;
