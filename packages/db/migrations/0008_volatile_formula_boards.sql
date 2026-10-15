-- CUBE TRACK — 0008 boards com fórmulas voláteis (TODAY/NOW) para o recálculo diário do worker.
-- ADR 0038. O papel da aplicação não lista tenants (RLS): a função expõe apenas os pares
-- (tenant, board) necessários, sem dados de negócio.
CREATE OR REPLACE FUNCTION app.volatile_formula_boards()
RETURNS TABLE (tenant_id uuid, board_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT DISTINCT cd.tenant_id, cd.board_id
  FROM public.column_definitions cd
  JOIN public.boards b ON b.id = cd.board_id AND b.deleted_at IS NULL
  JOIN public.tenants t ON t.id = cd.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
  WHERE cd.type = 'formula'
    AND cd.deleted_at IS NULL
    AND (cd.settings ->> 'expression') ~* '(TODAY|NOW)\s*\(';
$$;
--> statement-breakpoint
ALTER FUNCTION app.volatile_formula_boards() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.volatile_formula_boards() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.volatile_formula_boards() TO app_rw;
