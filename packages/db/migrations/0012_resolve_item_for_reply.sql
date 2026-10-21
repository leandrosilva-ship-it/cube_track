-- CUBE TRACK — 0012 Prompt 7: resolve o tenant/board de um item sem contexto de tenant, para o
-- webhook de e-mail recebido (ADR 0048) validar o endereço de resposta antes de abrir a transação.
-- Confirma também que o usuário do token continua com vínculo ativo no tenant do item.

CREATE OR REPLACE FUNCTION app.resolve_item_for_reply(p_item_id uuid, p_user_id uuid)
RETURNS TABLE (tenant_id uuid, board_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT i.tenant_id, i.board_id
  FROM public.items i
  JOIN public.tenants t ON t.id = i.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
  JOIN public.memberships m
    ON m.tenant_id = i.tenant_id AND m.user_id = p_user_id
    AND m.status = 'active' AND m.deleted_at IS NULL
  WHERE i.id = p_item_id AND i.deleted_at IS NULL;
$$;
--> statement-breakpoint
ALTER FUNCTION app.resolve_item_for_reply(uuid, uuid) OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.resolve_item_for_reply(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_item_for_reply(uuid, uuid) TO app_rw;
