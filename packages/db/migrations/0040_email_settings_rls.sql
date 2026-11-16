-- CUBE PROJECT — 0040 RLS/updated_at de email_settings (SMTP por tenant, mesmo padrão de ai_settings)

SELECT app.enable_tenant_rls('public.email_settings');
--> statement-breakpoint
CREATE TRIGGER email_settings_set_updated_at BEFORE UPDATE ON public.email_settings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
