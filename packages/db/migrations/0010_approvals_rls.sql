-- CUBE TRACK — 0010 Prompt 7: RLS e updated_at das tabelas de aprovação.
-- ADR: 0048 (painel do item — aprovações).

SELECT app.enable_tenant_rls('public.approval_requests');
--> statement-breakpoint
CREATE TRIGGER approval_requests_set_updated_at BEFORE UPDATE ON public.approval_requests
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.approval_approvers');
--> statement-breakpoint
CREATE TRIGGER approval_approvers_set_updated_at BEFORE UPDATE ON public.approval_approvers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
