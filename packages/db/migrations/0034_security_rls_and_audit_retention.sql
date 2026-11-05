-- CUBE TRACK — 0034: RLS/updated_at das tabelas novas do Prompt 16 (segurança avançada, ADR 0057:
-- SSO SAML 2.0, políticas de senha/sessão/IP e LGPD), catálogo de permissões correspondente, e as
-- funções de expurgo de retenção de auditoria (`maintenance.ts`, job `audit-retention-purge`) — sem
-- esta migração, provisionar um tenant novo falha (FK de role_permissions.permission_key), mesmo
-- padrão de 0018/0026/0028.

INSERT INTO public.permissions (key, scope, module, description) VALUES
  ('audit.export', 'tenant', 'governance', 'Exporta entradas de auditoria (CSV/NDJSON)'),
  ('sso.manage', 'tenant', 'governance', 'Configura SSO SAML 2.0/SCIM do tenant'),
  ('security_policy.manage', 'tenant', 'governance', 'Configura política de senha/sessão e allowlist de IP/domínio'),
  ('lgpd.manage', 'tenant', 'governance', 'Administra solicitações de titular LGPD e a política de retenção')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.sso_configurations');
--> statement-breakpoint
CREATE TRIGGER sso_configurations_set_updated_at BEFORE UPDATE ON public.sso_configurations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.security_policies');
--> statement-breakpoint
CREATE TRIGGER security_policies_set_updated_at BEFORE UPDATE ON public.security_policies
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.consent_records');
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.data_subject_requests');
--> statement-breakpoint
CREATE TRIGGER data_subject_requests_set_updated_at BEFORE UPDATE ON public.data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Índices de apoio à busca avançada de auditoria (`GET /v1/audit/entries`, ADR 0057): a tabela já
-- tinha `audit_logs_tenant_entity_idx`/`audit_logs_tenant_actor_idx` (0002) para os filtros por
-- entidade/ator; faltava um índice simples por ação e um por tipo de ator, os dois filtros restantes
-- do endpoint de busca. `audit_logs` é particionada (`audit.ts` fica fora do diff do drizzle-kit, ver
-- `drizzle.config.ts`) — os índices abaixo são criados em CADA partição automaticamente por serem
-- declarados na tabela-mãe particionada.
CREATE INDEX audit_logs_tenant_action_idx ON public.audit_logs (tenant_id, action, created_at);
--> statement-breakpoint
CREATE INDEX audit_logs_tenant_actor_kind_idx ON public.audit_logs (tenant_id, actor_kind, created_at);
--> statement-breakpoint

-- Retorna, para cada tenant com política de retenção de auditoria HABILITADA, o prazo configurado
-- (dias). SECURITY DEFINER: cruza tenants, chamada só pelo job de manutenção do worker — nenhuma
-- GRANT adicional além de app_rw (mesmo padrão de app.active_oauth_calendar_connections, 0032).
CREATE OR REPLACE FUNCTION app.audit_retention_policies()
RETURNS TABLE (tenant_id uuid, retention_days integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT p.tenant_id, p.retention_days
  FROM public.data_retention_policies p
  WHERE p.entity_type = 'audit_log' AND p.is_enabled;
$$;
--> statement-breakpoint
ALTER FUNCTION app.audit_retention_policies() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.audit_retention_policies() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.audit_retention_policies() TO app_rw;
--> statement-breakpoint

-- Expurgo de retenção de auditoria (ADR 0057, LGPD: minimização). `audit_logs` é append-only por
-- TRIGGER de linha (`audit_logs_append_only`, 0002: bloqueia UPDATE/DELETE incondicionalmente, mesmo
-- para SECURITY DEFINER) — a única forma de remover dados antigos é DROP TABLE de partições MENSAIS
-- inteiras (DDL, não dispara trigger de linha). Granularidade mensal: dropa só partições cujo mês
-- termina antes de `p_before` (nunca uma partição parcialmente dentro do prazo de retenção de
-- qualquer tenant — o chamador em TypeScript usa o MAIOR prazo configurado entre tenants, ver
-- `apps/worker/src/processors/maintenance.ts`, função `purgeAuditLogs`). Retorna os nomes das
-- partições removidas, para auditoria/log.
CREATE OR REPLACE FUNCTION app.purge_audit_log_partitions(p_before timestamptz)
RETURNS text[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
DECLARE
  v_partition record;
  v_dropped text[] := '{}';
BEGIN
  FOR v_partition IN
    SELECT c.relname AS name,
           to_date(substring(c.relname FROM 'audit_logs_(\d{4}_\d{2})$'), 'YYYY_MM') AS month_start
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_logs' AND c.relname ~ '^audit_logs_\d{4}_\d{2}$'
  LOOP
    IF v_partition.month_start IS NOT NULL
       AND (v_partition.month_start + interval '1 month') <= p_before THEN
      EXECUTE format('DROP TABLE public.%I', v_partition.name);
      v_dropped := array_append(v_dropped, v_partition.name);
    END IF;
  END LOOP;
  RETURN v_dropped;
END
$$;
--> statement-breakpoint
ALTER FUNCTION app.purge_audit_log_partitions(timestamptz) OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.purge_audit_log_partitions(timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.purge_audit_log_partitions(timestamptz) TO app_rw;
