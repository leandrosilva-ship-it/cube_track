-- CUBE TRACK — 0000 bootstrap
-- Extensões, schema de funções `app`, papéis de banco (ADR 0004) e gerador UUIDv7 (ADR 0014).
-- Executado pelo papel dono do schema (migrator).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
COMMENT ON SCHEMA app IS 'Funções de plataforma do CUBE TRACK: contexto de tenant, RLS, IDs, auditoria.';
--> statement-breakpoint

-- Papéis sem login. Usuários de conexão (LOGIN) são criados por ambiente e recebem estes papéis.
--   app_rw         aplicação (API, realtime, worker): DML sujeito a RLS, sem BYPASSRLS.
--   app_ro         leitura (réplicas, relatórios): SELECT sujeito a RLS.
--   platform_admin operações de plataforma (login antes do tenant, suporte): BYPASSRLS, uso auditado.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_admin') THEN
    CREATE ROLE platform_admin NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO app_rw, app_ro, platform_admin;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_rw, app_ro, platform_admin;
--> statement-breakpoint

-- UUIDv7 (RFC 9562): 48 bits de timestamp em ms + bits aleatórios de gen_random_uuid().
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;
--> statement-breakpoint

-- Contexto da requisição: definido por transação com set_config(..., true) (compatível com PgBouncer).
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid;
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.uuid_v7(), app.current_tenant_id(), app.current_user_id()
  TO app_rw, app_ro, platform_admin;
