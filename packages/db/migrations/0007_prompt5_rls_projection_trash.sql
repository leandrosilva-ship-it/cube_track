-- CUBE TRACK — 0007 Prompt 5: leitura de itens, projeção de rollup e expurgo da lixeira.
-- ADRs: 0005/0020 (projeção tipada), 0038 (colunas calculadas), 0041 (lixeira com 30 dias).

-- Última visualização de itens: isolamento por tenant e updated_at.
SELECT app.enable_tenant_rls('public.item_reads');
--> statement-breakpoint
CREATE TRIGGER item_reads_set_updated_at BEFORE UPDATE ON public.item_reads
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Projeção tipada: inclui o rollup entre os tipos calculados (espelha columns/registry.ts).
CREATE OR REPLACE FUNCTION app.project_value(
  p_type text, p_value jsonb,
  OUT v_num numeric, OUT v_date date, OUT v_date_end date, OUT v_text text, OUT v_bool boolean
)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  CASE p_type
    WHEN 'number', 'rating', 'time_tracking' THEN
      v_num := (p_value ->> 'n')::numeric;
    WHEN 'date' THEN
      v_date := (p_value ->> 'd')::date;
    WHEN 'timeline', 'week' THEN
      v_date := (p_value ->> 'from')::date;
      v_date_end := (p_value ->> 'to')::date;
    WHEN 'text', 'long_text' THEN
      v_text := left(lower(p_value ->> 'text'), 256);
    WHEN 'link' THEN
      v_text := left(lower(coalesce(p_value ->> 'text', p_value ->> 'url')), 256);
    WHEN 'email' THEN
      v_text := lower(p_value ->> 'email');
    WHEN 'phone' THEN
      v_text := p_value ->> 'phone';
    WHEN 'status' THEN
      v_text := p_value ->> 'labelId';
    WHEN 'country' THEN
      v_text := p_value ->> 'code';
    WHEN 'color' THEN
      v_text := lower(p_value ->> 'color');
    WHEN 'hour' THEN
      v_text := p_value ->> 'time';
    WHEN 'location' THEN
      v_text := left(lower(p_value ->> 'address'), 256);
    WHEN 'checkbox' THEN
      v_bool := (p_value ->> 'checked')::boolean;
    WHEN 'auto_id' THEN
      v_num := (p_value ->> 'seq')::numeric;
      v_text := lower(p_value ->> 'text');
    WHEN 'formula', 'mirror', 'progress', 'rollup' THEN
      v_num := (p_value ->> 'n')::numeric;
      v_date := (p_value ->> 'd')::date;
      v_text := left(lower(p_value ->> 'text'), 256);
    ELSE
      NULL;
  END CASE;
END
$$;
--> statement-breakpoint

-- Expurgo da lixeira: remove definitivamente grupos e itens excluídos antes de `p_before` em todos
-- os tenants (job diário do worker). Retorna as contagens por tenant para auditoria.
CREATE OR REPLACE FUNCTION app.purge_trash(p_before timestamptz)
RETURNS TABLE (tenant_id uuid, items_purged integer, groups_purged integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
BEGIN
  RETURN QUERY
  WITH purged AS (
    DELETE FROM public.groups g WHERE g.deleted_at < p_before RETURNING g.tenant_id
  )
  SELECT purged.tenant_id, 0, count(*)::integer FROM purged GROUP BY purged.tenant_id;
  RETURN QUERY
  WITH purged AS (
    DELETE FROM public.items i WHERE i.deleted_at < p_before RETURNING i.tenant_id
  )
  SELECT purged.tenant_id, count(*)::integer, 0 FROM purged GROUP BY purged.tenant_id;
END
$$;
--> statement-breakpoint
ALTER FUNCTION app.purge_trash(timestamptz) OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.purge_trash(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_trash(timestamptz) TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_reads TO app_rw, platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.item_reads TO app_ro;
--> statement-breakpoint

-- ID automático também ao mover o item para outro board (as colunas auto_id do destino recebem
-- o próximo número; valores já mapeados são mantidos).
DROP TRIGGER IF EXISTS items_assign_auto_ids ON public.items;
--> statement-breakpoint
CREATE TRIGGER items_assign_auto_ids BEFORE INSERT OR UPDATE OF board_id ON public.items
  FOR EACH ROW EXECUTE FUNCTION app.items_assign_auto_ids();
--> statement-breakpoint

-- Numera os itens existentes ao criar uma coluna de ID automático (ordem de criação).
CREATE OR REPLACE FUNCTION app.backfill_auto_ids(p_column_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  col record;
  it record;
  v_timezone text;
  v_date date;
  v_seq bigint;
  v_count integer := 0;
BEGIN
  SELECT cd.id, cd.tenant_id, cd.board_id, cd.key, cd.settings INTO col
  FROM public.column_definitions cd
  WHERE cd.id = p_column_id AND cd.type = 'auto_id' AND cd.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  SELECT t.timezone INTO v_timezone FROM public.tenants t WHERE t.id = col.tenant_id;
  FOR it IN
    SELECT i.id, i.created_at, i.parent_item_id
    FROM public.items i
    WHERE i.tenant_id = col.tenant_id AND i.board_id = col.board_id
      AND i.deleted_at IS NULL AND NOT (i.values ? col.key)
    ORDER BY i.created_at, i.id
  LOOP
    CONTINUE WHEN it.parent_item_id IS NOT NULL
      AND NOT coalesce((col.settings ->> 'applyToSubitems')::boolean, false);
    v_date := (it.created_at AT TIME ZONE coalesce(v_timezone, 'America/Sao_Paulo'))::date;
    v_seq := app.next_sequence(
      col.tenant_id,
      'column:' || col.id::text,
      CASE coalesce(col.settings ->> 'resetPeriod', 'never')
        WHEN 'yearly' THEN to_char(v_date, 'YYYY')
        WHEN 'monthly' THEN to_char(v_date, 'YYYY-MM')
        ELSE ''
      END
    );
    UPDATE public.items
    SET values = values || jsonb_build_object(
      col.key,
      jsonb_build_object(
        'text', app.format_display_id(coalesce(col.settings ->> 'mask', '{YYYY}-{SEQ:4}'), v_seq, v_date),
        'seq', v_seq
      )
    )
    WHERE id = it.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;
