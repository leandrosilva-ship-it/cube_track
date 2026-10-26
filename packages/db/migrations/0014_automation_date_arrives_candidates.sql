-- CUBE TRACK — 0014 candidatos do gatilho `date_arrives` para a varredura diária do worker (ADR 0051).
-- O papel da aplicação não lista tenants/automações entre tenants (RLS): a função expõe apenas os
-- trios (tenant, automação, item) que batem com a data de hoje, sem outros dados de negócio.
CREATE OR REPLACE FUNCTION app.date_arrives_candidates()
RETURNS TABLE (tenant_id uuid, automation_id uuid, item_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
DECLARE
  rule record;
  v_column_key text;
  v_offset_days int;
  v_target_date date;
BEGIN
  FOR rule IN
    SELECT a.id, a.tenant_id, a.board_id, a.workspace_id, a.trigger, t.timezone
    FROM public.automations a
    JOIN public.tenants t ON t.id = a.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
    WHERE a.is_enabled
      AND a.deleted_at IS NULL
      AND a.trigger ->> 'type' = 'date_arrives'
  LOOP
    v_column_key := rule.trigger -> 'config' ->> 'columnKey';
    v_offset_days := COALESCE((rule.trigger -> 'config' ->> 'offsetDays')::int, 0);
    IF v_column_key IS NULL THEN
      CONTINUE;
    END IF;
    -- "Hoje" no fuso do tenant (mesma convenção de `localDate` em packages/shared).
    v_target_date := (now() AT TIME ZONE COALESCE(rule.timezone, 'America/Sao_Paulo'))::date
      - v_offset_days;

    IF v_column_key IN (
      'plannedStartDate', 'plannedEndDate', 'replannedStartDate',
      'replannedEndDate', 'actualStartDate', 'actualEndDate'
    ) THEN
      RETURN QUERY
        SELECT i.tenant_id, rule.id, i.id
        FROM public.items i
        JOIN public.boards b ON b.id = i.board_id
        WHERE i.deleted_at IS NULL
          AND i.archived_at IS NULL
          AND (
            (rule.board_id IS NOT NULL AND i.board_id = rule.board_id)
            OR (rule.board_id IS NULL AND b.workspace_id = rule.workspace_id)
          )
          AND (
            CASE v_column_key
              WHEN 'plannedStartDate' THEN i.planned_start_date
              WHEN 'plannedEndDate' THEN i.planned_end_date
              WHEN 'replannedStartDate' THEN i.replanned_start_date
              WHEN 'replannedEndDate' THEN i.replanned_end_date
              WHEN 'actualStartDate' THEN i.actual_start_date
              WHEN 'actualEndDate' THEN i.actual_end_date
            END
          ) = v_target_date;
    ELSE
      RETURN QUERY
        SELECT i.tenant_id, rule.id, i.id
        FROM public.items i
        JOIN public.boards b ON b.id = i.board_id
        WHERE i.deleted_at IS NULL
          AND i.archived_at IS NULL
          AND (
            (rule.board_id IS NOT NULL AND i.board_id = rule.board_id)
            OR (rule.board_id IS NULL AND b.workspace_id = rule.workspace_id)
          )
          AND (i.values -> v_column_key ->> 'd') = v_target_date::text;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION app.date_arrives_candidates() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.date_arrives_candidates() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.date_arrives_candidates() TO app_rw;
