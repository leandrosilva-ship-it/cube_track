-- Executado uma única vez na criação do volume do PostgreSQL de desenvolvimento.
-- Papéis de grupo (também criados, de forma idempotente, pela migração 0000_bootstrap) e
-- usuários de conexão da aplicação. NUNCA use estas senhas fora do ambiente local.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    CREATE ROLE app_rw NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ro') THEN
    CREATE ROLE app_ro NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_admin') THEN
    CREATE ROLE platform_admin NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cubetrack_app') THEN
    CREATE ROLE cubetrack_app LOGIN PASSWORD 'cubetrack_app' IN ROLE app_rw;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cubetrack_readonly') THEN
    CREATE ROLE cubetrack_readonly LOGIN PASSWORD 'cubetrack_readonly' IN ROLE app_ro;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE cubetrack TO cubetrack_app, cubetrack_readonly;
