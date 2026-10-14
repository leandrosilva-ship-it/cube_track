-- CUBE TRACK — 0002 RLS, auditoria, triggers e funções de plataforma
-- ADRs: 0004 (multi-tenancy/RLS), 0005/0020 (projeção tipada), 0015/0021 (auditoria), 0022 (ID automático).

------------------------------------------------------------------------------------------------
-- 1. updated_at automático
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
      t.table_name || '_set_updated_at', t.table_name
    );
  END LOOP;
END
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 2. Row Level Security por tenant
------------------------------------------------------------------------------------------------
-- Aplica isolamento padrão: ENABLE + FORCE + política única USING/WITH CHECK por tenant_id.
-- Toda tabela nova com tenant_id NOT NULL deve chamar esta função na sua migração.
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(p_table regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL '
    'USING (tenant_id = app.current_tenant_id()) '
    'WITH CHECK (tenant_id = app.current_tenant_id())',
    p_table
  );
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.is_nullable = 'NO'
  LOOP
    PERFORM app.enable_tenant_rls(format('public.%I', t.table_name)::regclass);
  END LOOP;
END
$$;
--> statement-breakpoint

-- tenants: a linha visível é apenas a do tenant corrente.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_self ON public.tenants
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());
--> statement-breakpoint

-- users: identidade global. Sem FORCE (o dono/migrator gerencia o catálogo de plataforma);
-- papéis da aplicação veem o próprio usuário e quem tem membership no tenant corrente,
-- e só atualizam o próprio perfil. Criação via app.ensure_user (SECURITY DEFINER).
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_select ON public.users FOR SELECT
  USING (
    id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.user_id = users.id AND m.deleted_at IS NULL)
  );
--> statement-breakpoint
CREATE POLICY users_update_self ON public.users FOR UPDATE
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());
--> statement-breakpoint

-- Catálogos com tenant_id opcional: linhas globais (tenant_id nulo) são somente leitura.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holidays', 'templates'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY global_or_tenant_read ON public.%I FOR SELECT '
      'USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT '
      'WITH CHECK (tenant_id = app.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE '
      'USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE '
      'USING (tenant_id = app.current_tenant_id())', t);
  END LOOP;
END
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 3. Auditoria append-only, particionada e com hash encadeado
------------------------------------------------------------------------------------------------
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  actor_kind public.actor_kind NOT NULL DEFAULT 'user',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  chain_seq bigint NOT NULL,
  prev_hash text,
  hash text NOT NULL,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX audit_logs_tenant_entity_idx ON public.audit_logs (tenant_id, entity_type, entity_id, created_at);
--> statement-breakpoint
CREATE INDEX audit_logs_tenant_actor_idx ON public.audit_logs (tenant_id, created_by, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX audit_logs_tenant_chain_key ON public.audit_logs (tenant_id, chain_seq, created_at);
--> statement-breakpoint
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_tenant_read ON public.audit_logs FOR SELECT
  USING (tenant_id = app.current_tenant_id());
--> statement-breakpoint
CREATE POLICY audit_tenant_insert ON public.audit_logs FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

-- Cria partições mensais. Partições não recebem privilégios diretos dos papéis da aplicação
-- e têm RLS habilitado sem políticas (acesso somente via tabela-mãe).
CREATE OR REPLACE FUNCTION app.ensure_audit_partitions(p_from date, p_months integer) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_start date := date_trunc('month', p_from)::date;
  v_end date;
  v_name text;
  v_created integer := 0;
BEGIN
  FOR i IN 0 .. p_months - 1 LOOP
    v_end := (v_start + interval '1 month')::date;
    v_name := format('audit_logs_%s', to_char(v_start, 'YYYY_MM'));
    IF to_regclass(format('public.%I', v_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
        v_name, v_start, v_end);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_rw, app_ro, platform_admin', v_name);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_name);
      v_created := v_created + 1;
    END IF;
    v_start := v_end;
  END LOOP;
  RETURN v_created;
END
$$;
--> statement-breakpoint
CREATE TABLE public.audit_logs_default PARTITION OF public.audit_logs DEFAULT;
--> statement-breakpoint
SELECT app.ensure_audit_partitions((date_trunc('month', now()) - interval '12 months')::date, 25);
--> statement-breakpoint

-- Representação canônica do registro para hash (jsonb::text é normalizado pelo PostgreSQL).
CREATE OR REPLACE FUNCTION app.audit_hash(p_prev_hash text, r public.audit_logs) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(
    sha256(convert_to(
      coalesce(p_prev_hash, '') || '|' ||
      r.id::text || '|' || r.tenant_id::text || '|' || r.chain_seq::text || '|' ||
      to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
      coalesce(r.created_by::text, '') || '|' || r.actor_kind::text || '|' ||
      r.action || '|' || r.entity_type || '|' || coalesce(r.entity_id::text, '') || '|' ||
      coalesce(r.before::text, '') || '|' || coalesce(r.after::text, '') || '|' ||
      coalesce(host(r.ip), '') || '|' || coalesce(r.request_id, '') || '|' || r.metadata::text,
      'UTF8'
    )),
    'hex'
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.audit_logs_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
DECLARE
  v_seq bigint;
  v_prev text;
BEGIN
  INSERT INTO public.audit_chain_heads (tenant_id) VALUES (NEW.tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
  -- O lock da linha serializa a cadeia por tenant até o fim da transação.
  SELECT last_seq, last_hash INTO v_seq, v_prev
    FROM public.audit_chain_heads WHERE tenant_id = NEW.tenant_id FOR UPDATE;
  NEW.chain_seq := v_seq + 1;
  NEW.prev_hash := v_prev;
  NEW.hash := app.audit_hash(v_prev, NEW);
  UPDATE public.audit_chain_heads
     SET last_seq = NEW.chain_seq, last_hash = NEW.hash, updated_at = now()
   WHERE tenant_id = NEW.tenant_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_chain BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.audit_logs_chain();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é append-only: % não é permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.prevent_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION app.prevent_mutation();
--> statement-breakpoint

-- Verificação da cadeia: retorna os registros cujo hash não confere (vazio = íntegra).
CREATE OR REPLACE FUNCTION app.verify_audit_chain(p_tenant_id uuid)
RETURNS TABLE (chain_seq bigint, expected_hash text, stored_hash text)
LANGUAGE sql STABLE AS $$
  WITH ordered AS (
    SELECT a, lag(a.hash) OVER (ORDER BY a.chain_seq) AS prev_stored,
           lag(a.chain_seq) OVER (ORDER BY a.chain_seq) AS prev_seq
    FROM public.audit_logs a
    WHERE a.tenant_id = p_tenant_id
  )
  SELECT (o.a).chain_seq, app.audit_hash(o.prev_stored, o.a), (o.a).hash
  FROM ordered o
  WHERE app.audit_hash(o.prev_stored, o.a) <> (o.a).hash
     OR (o.a).prev_hash IS DISTINCT FROM o.prev_stored
     OR (o.prev_seq IS NOT NULL AND (o.a).chain_seq <> o.prev_seq + 1)
     OR (o.prev_seq IS NULL AND (o.a).chain_seq <> 1);
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 4. ID automático com máscara (coluna `auto_id`)
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.format_display_id(p_mask text, p_seq bigint, p_date date) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_result text := p_mask;
  v_width text[];
BEGIN
  IF p_seq IS NULL OR p_seq < 1 THEN
    RAISE EXCEPTION 'Sequência inválida: %', p_seq;
  END IF;
  v_result := replace(v_result, '{YYYY}', lpad(extract(year FROM p_date)::text, 4, '0'));
  v_result := replace(v_result, '{YY}', lpad((extract(year FROM p_date)::int % 100)::text, 2, '0'));
  v_result := replace(v_result, '{MM}', lpad(extract(month FROM p_date)::text, 2, '0'));
  v_result := replace(v_result, '{DD}', lpad(extract(day FROM p_date)::text, 2, '0'));
  v_width := regexp_match(v_result, '\{SEQ:(\d{1,2})\}');
  IF v_width IS NOT NULL THEN
    v_result := regexp_replace(
      v_result, '\{SEQ:\d{1,2}\}',
      lpad(p_seq::text, greatest(v_width[1]::int, length(p_seq::text)), '0'));
  END IF;
  RETURN replace(v_result, '{SEQ}', p_seq::text);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.next_sequence(p_tenant_id uuid, p_scope text, p_period_key text)
RETURNS bigint
LANGUAGE sql VOLATILE AS $$
  INSERT INTO public.id_sequences (tenant_id, scope, period_key, current_value)
  VALUES (p_tenant_id, p_scope, coalesce(p_period_key, ''), 1)
  ON CONFLICT (tenant_id, scope, period_key)
  DO UPDATE SET current_value = public.id_sequences.current_value + 1
  RETURNING current_value;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.items_assign_auto_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  col record;
  v_date date;
  v_period text;
  v_seq bigint;
BEGIN
  FOR col IN
    SELECT cd.id, cd.key, cd.settings
    FROM public.column_definitions cd
    WHERE cd.tenant_id = NEW.tenant_id
      AND cd.board_id = NEW.board_id
      AND cd.type = 'auto_id'
      AND cd.deleted_at IS NULL
    ORDER BY cd.position
  LOOP
    CONTINUE WHEN NEW.values ? col.key;
    CONTINUE WHEN NEW.parent_item_id IS NOT NULL
      AND NOT coalesce((col.settings ->> 'applyToSubitems')::boolean, false);
    IF v_date IS NULL THEN
      SELECT (now() AT TIME ZONE t.timezone)::date INTO v_date FROM public.tenants t WHERE t.id = NEW.tenant_id;
      v_date := coalesce(v_date, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
    END IF;
    v_period := CASE coalesce(col.settings ->> 'resetPeriod', 'never')
      WHEN 'yearly' THEN to_char(v_date, 'YYYY')
      WHEN 'monthly' THEN to_char(v_date, 'YYYY-MM')
      ELSE ''
    END;
    v_seq := app.next_sequence(NEW.tenant_id, 'column:' || col.id::text, v_period);
    NEW.values := NEW.values || jsonb_build_object(
      col.key,
      jsonb_build_object(
        'text', app.format_display_id(coalesce(col.settings ->> 'mask', '{YYYY}-{SEQ:4}'), v_seq, v_date),
        'seq', v_seq
      )
    );
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER items_assign_auto_ids BEFORE INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION app.items_assign_auto_ids();
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 5. Subitens: no máximo um nível
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.items_validate_hierarchy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_item_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.items p WHERE p.id = NEW.parent_item_id AND p.parent_item_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Subitens não podem ter subitens (item %)', NEW.id USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.items c WHERE c.parent_item_id = NEW.id) THEN
      RAISE EXCEPTION 'Item com subitens não pode virar subitem (item %)', NEW.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER items_validate_hierarchy BEFORE INSERT OR UPDATE OF parent_item_id ON public.items
  FOR EACH ROW EXECUTE FUNCTION app.items_validate_hierarchy();
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 6. Projeção tipada de valores customizados (item_field_index)
------------------------------------------------------------------------------------------------
-- Espelha `projection` de packages/shared/src/columns/registry.ts.
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
    WHEN 'checkbox' THEN
      v_bool := (p_value ->> 'checked')::boolean;
    WHEN 'auto_id' THEN
      v_num := (p_value ->> 'seq')::numeric;
      v_text := lower(p_value ->> 'text');
    WHEN 'formula', 'mirror', 'progress' THEN
      v_num := (p_value ->> 'n')::numeric;
      v_date := (p_value ->> 'd')::date;
      v_text := left(lower(p_value ->> 'text'), 256);
    ELSE
      NULL;
  END CASE;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.items_project_values() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Em INSERT não há projeção anterior: evita um DELETE por linha em cargas em massa.
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.item_field_index WHERE item_id = NEW.id;
  END IF;
  INSERT INTO public.item_field_index (tenant_id, board_id, item_id, column_key, v_num, v_date, v_date_end, v_text, v_bool)
  SELECT NEW.tenant_id, NEW.board_id, NEW.id, cd.key, p.v_num, p.v_date, p.v_date_end, p.v_text, p.v_bool
  FROM public.column_definitions cd
  CROSS JOIN LATERAL app.project_value(cd.type, NEW.values -> cd.key) p
  WHERE cd.tenant_id = NEW.tenant_id
    AND cd.board_id = NEW.board_id
    AND cd.deleted_at IS NULL
    AND cd.binding IS NULL
    AND NEW.values ? cd.key
    AND num_nonnulls(p.v_num, p.v_date, p.v_date_end, p.v_text, p.v_bool) > 0;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER items_project_values_insert AFTER INSERT ON public.items
  FOR EACH ROW EXECUTE FUNCTION app.items_project_values();
--> statement-breakpoint
CREATE TRIGGER items_project_values_update AFTER UPDATE OF values, board_id ON public.items
  FOR EACH ROW
  WHEN (OLD.values IS DISTINCT FROM NEW.values OR OLD.board_id IS DISTINCT FROM NEW.board_id)
  EXECUTE FUNCTION app.items_project_values();
--> statement-breakpoint

-- Reprojeta todos os itens de um board (após criar coluna ou mudar o tipo). Executado pelo worker.
CREATE OR REPLACE FUNCTION app.reproject_board(p_board_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.item_field_index WHERE board_id = p_board_id;
  INSERT INTO public.item_field_index (tenant_id, board_id, item_id, column_key, v_num, v_date, v_date_end, v_text, v_bool)
  SELECT i.tenant_id, i.board_id, i.id, cd.key, p.v_num, p.v_date, p.v_date_end, p.v_text, p.v_bool
  FROM public.items i
  JOIN public.column_definitions cd
    ON cd.tenant_id = i.tenant_id AND cd.board_id = i.board_id AND cd.deleted_at IS NULL AND cd.binding IS NULL
  CROSS JOIN LATERAL app.project_value(cd.type, i.values -> cd.key) p
  WHERE i.board_id = p_board_id
    AND i.values ? cd.key
    AND num_nonnulls(p.v_num, p.v_date, p.v_date_end, p.v_text, p.v_bool) > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 7. Contexto de tenant e funções SECURITY DEFINER (resolução antes do contexto)
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.set_context(p_tenant_id uuid, p_user_id uuid) RETURNS void
LANGUAGE sql VOLATILE AS $$
  SELECT set_config('app.tenant_id', coalesce(p_tenant_id::text, ''), true),
         set_config('app.user_id', coalesce(p_user_id::text, ''), true);
$$;
--> statement-breakpoint
-- Funções definer pertencem a platform_admin (BYPASSRLS) para funcionar mesmo quando o
-- migrator não é superusuário. O migrator precisa ser membro de platform_admin para o ALTER OWNER.
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND NOT pg_has_role(current_user, 'platform_admin', 'MEMBER') THEN
    BEGIN
      EXECUTE format('GRANT platform_admin TO %I', current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'O papel de migração (%) precisa ser membro de platform_admin (ou ter ADMIN OPTION nele).', current_user
        USING HINT = 'Como administrador do cluster: GRANT platform_admin TO <migrator> WITH ADMIN OPTION;';
    END;
  END IF;
END
$$;
--> statement-breakpoint
-- O novo dono de uma função precisa de CREATE no schema (exigência do ALTER ... OWNER TO).
GRANT CREATE ON SCHEMA app TO platform_admin;
--> statement-breakpoint
-- Cria (ou retorna) o usuário global pelo e-mail.
CREATE OR REPLACE FUNCTION app.ensure_user(p_email text, p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_email IS NULL OR p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'E-mail inválido' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.users (email, name) VALUES (lower(p_email), p_name)
  ON CONFLICT (lower(email)) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.users WHERE lower(email) = lower(p_email);
  END IF;
  RETURN v_id;
END
$$;
--> statement-breakpoint
-- Link público: retorna o recurso compartilhado de um token válido (hash SHA-256 em hex).
CREATE OR REPLACE FUNCTION app.resolve_share_link(p_token_hash text)
RETURNS TABLE (tenant_id uuid, share_link_id uuid, resource_type public.share_resource, resource_id uuid, requires_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT s.tenant_id, s.id, s.resource_type, s.resource_id, s.password_hash IS NOT NULL
  FROM public.share_links s
  JOIN public.tenants t ON t.id = s.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND (s.expires_at IS NULL OR s.expires_at > now());
$$;
--> statement-breakpoint
-- Formulário público: retorna o formulário ativo de um token válido.
CREATE OR REPLACE FUNCTION app.resolve_public_form(p_token_hash text)
RETURNS TABLE (tenant_id uuid, form_id uuid, board_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT f.tenant_id, f.id, f.board_id
  FROM public.forms f
  JOIN public.tenants t ON t.id = f.tenant_id AND t.status = 'active' AND t.deleted_at IS NULL
  WHERE f.public_token_hash = p_token_hash
    AND f.is_public AND f.is_active AND f.deleted_at IS NULL
    AND (f.closes_at IS NULL OR f.closes_at > now());
$$;
--> statement-breakpoint
-- Tenants de um usuário (seletor de organização no login, antes do contexto de tenant).
CREATE OR REPLACE FUNCTION app.user_tenants(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, name text, slug text, kind public.membership_kind)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT t.id, t.name, t.slug, m.kind
  FROM public.memberships m
  JOIN public.tenants t ON t.id = m.tenant_id AND t.deleted_at IS NULL AND t.status = 'active'
  WHERE m.user_id = p_user_id AND m.status = 'active' AND m.deleted_at IS NULL
  ORDER BY t.name;
$$;
--> statement-breakpoint
ALTER FUNCTION app.audit_logs_chain() OWNER TO platform_admin;
--> statement-breakpoint
ALTER FUNCTION app.ensure_user(text, text) OWNER TO platform_admin;
--> statement-breakpoint
ALTER FUNCTION app.resolve_share_link(text) OWNER TO platform_admin;
--> statement-breakpoint
ALTER FUNCTION app.resolve_public_form(text) OWNER TO platform_admin;
--> statement-breakpoint
ALTER FUNCTION app.user_tenants(uuid) OWNER TO platform_admin;
--> statement-breakpoint

------------------------------------------------------------------------------------------------
-- 8. Privilégios
------------------------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw, platform_admin;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;
--> statement-breakpoint
-- Catálogo de permissões: somente leitura.
REVOKE INSERT, UPDATE, DELETE ON public.permissions FROM app_rw;
--> statement-breakpoint
-- Usuários: criação via app.ensure_user; sem exclusão física (anonimização LGPD).
REVOKE INSERT, DELETE ON public.users FROM app_rw;
--> statement-breakpoint
-- Auditoria: somente INSERT/SELECT; a cabeça da cadeia é mantida apenas pelo trigger.
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM app_rw, app_ro, platform_admin;
--> statement-breakpoint
REVOKE ALL ON public.audit_chain_heads FROM app_rw, app_ro;
--> statement-breakpoint
-- Partições: sem acesso direto (o GRANT ON ALL TABLES acima as incluiu).
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT inhrelid::regclass AS rel FROM pg_inherits WHERE inhparent = 'public.audit_logs'::regclass LOOP
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, app_rw, app_ro, platform_admin', p.rel);
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p.rel);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', p.rel);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Projeção: mantida por triggers; a aplicação só lê.
REVOKE INSERT, UPDATE, DELETE ON public.item_field_index FROM app_rw;
--> statement-breakpoint
-- Os triggers de projeção executam como o usuário da sessão; concedemos a escrita apenas via funções.
ALTER FUNCTION app.items_project_values() SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION app.items_project_values() SET search_path = pg_catalog, public, app;
--> statement-breakpoint
ALTER FUNCTION app.items_project_values() OWNER TO platform_admin;
--> statement-breakpoint
ALTER FUNCTION app.reproject_board(uuid) SECURITY DEFINER;
--> statement-breakpoint
ALTER FUNCTION app.reproject_board(uuid) SET search_path = pg_catalog, public, app;
--> statement-breakpoint
ALTER FUNCTION app.reproject_board(uuid) OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO app_rw, platform_admin;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.current_user_id(), app.set_context(uuid, uuid),
  app.format_display_id(text, bigint, date), app.project_value(text, jsonb) TO app_ro;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.enable_tenant_rls(regclass), app.ensure_audit_partitions(date, integer)
  FROM app_rw;
--> statement-breakpoint
-- Tabelas criadas no futuro pelo migrator recebem os mesmos privilégios padrão.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw, platform_admin;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_ro;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO app_rw, platform_admin;
