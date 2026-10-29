-- CUBE TRACK — Prompt 12: RLS e updated_at de health_rule_sets (tabela nova).
-- ADR: 0053 (gestão de portfólio — RAG automático por regras).

SELECT app.enable_tenant_rls('public.health_rule_sets');
--> statement-breakpoint
CREATE TRIGGER health_rule_sets_set_updated_at BEFORE UPDATE ON public.health_rule_sets
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
