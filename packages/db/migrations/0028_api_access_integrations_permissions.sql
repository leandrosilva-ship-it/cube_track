-- CUBE TRACK — 0028: RLS/updated_at das tabelas novas do Prompt 15 (API pública, integrações,
-- importadores, ADR 0056) e catálogo de permissões de `integrations.manage` — sem esta linha,
-- provisionar um tenant novo falha (FK de role_permissions.permission_key), mesmo padrão de 0018/0026.
-- `api_tokens`/`templates` já tinham RLS desde o início (0002: aplica a toda tabela com tenant_id NOT
-- NULL existente na época) — não precisam de nada novo aqui, só as tabelas CRIADAS nesta entrega.

INSERT INTO public.permissions (key, scope, module, description) VALUES
  ('integrations.manage', 'workspace', 'integrations', 'Conectar/configurar/desconectar integrações de terceiros do workspace')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.oauth_apps');
--> statement-breakpoint
CREATE TRIGGER oauth_apps_set_updated_at BEFORE UPDATE ON public.oauth_apps
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.import_jobs');
--> statement-breakpoint
CREATE TRIGGER import_jobs_set_updated_at BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.integration_connections');
--> statement-breakpoint
CREATE TRIGGER integration_connections_set_updated_at BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.calendar_sync_links');
--> statement-breakpoint
CREATE TRIGGER calendar_sync_links_set_updated_at BEFORE UPDATE ON public.calendar_sync_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.external_file_links');
--> statement-breakpoint
CREATE TRIGGER external_file_links_set_updated_at BEFORE UPDATE ON public.external_file_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.dev_event_links');
--> statement-breakpoint
CREATE TRIGGER dev_event_links_set_updated_at BEFORE UPDATE ON public.dev_event_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
