-- CUBE TRACK — 0038: RLS/updated_at das tabelas de billing (Prompt 16, ADR 0059), função de
-- resolução de tenant pelo id de cliente/assinatura do Stripe (webhook público, sem contexto de
-- tenant ainda — mesmo padrão de app.resolve_item_for_reply/app.resolve_tenant) e os candidatos da
-- rotina diária de reconciliação/dunning (app.billing_reconciliation_candidates, worker).

SELECT app.enable_tenant_rls('public.subscriptions');
--> statement-breakpoint
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

SELECT app.enable_tenant_rls('public.payment_records');
--> statement-breakpoint
CREATE TRIGGER payment_records_set_updated_at BEFORE UPDATE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
--> statement-breakpoint

-- Resolve o tenant dono de uma assinatura pelo id de cliente OU de assinatura do Stripe (um dos
-- dois pode faltar, nunca os dois). Chamado pelo webhook público `POST /v1/billing/stripe/webhook`
-- (sem sessão, sem `X-Tenant`) ANTES de abrir a transação com contexto de tenant — mesma razão de
-- `app.resolve_item_for_reply` (0012): sem isto, a consulta a `subscriptions` esbarraria na própria
-- RLS que ela existe para abrir.
CREATE OR REPLACE FUNCTION app.resolve_subscription_by_stripe_id(p_customer_id text, p_subscription_id text)
RETURNS TABLE (tenant_id uuid, subscription_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT s.tenant_id, s.id
  FROM public.subscriptions s
  WHERE (p_subscription_id IS NOT NULL AND s.stripe_subscription_id = p_subscription_id)
     OR (p_customer_id IS NOT NULL AND s.stripe_customer_id = p_customer_id)
  ORDER BY (s.stripe_subscription_id = p_subscription_id) DESC NULLS LAST
  LIMIT 1;
$$;
--> statement-breakpoint
ALTER FUNCTION app.resolve_subscription_by_stripe_id(text, text) OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.resolve_subscription_by_stripe_id(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.resolve_subscription_by_stripe_id(text, text) TO app_rw;
--> statement-breakpoint

-- Candidatos da rotina diária `billing-reconciliation-daily` (worker): assinaturas pagas (plano
-- diferente de 'free') já marcadas `past_due` pelo Stripe (dunning: reenvia o lembrete enquanto
-- durar) OU que ainda dizem `active` mas o período corrente já terminou há mais de 2 dias sem que
-- o webhook de renovação tenha chegado (rede de segurança — nunca a fonte de verdade, só atraso).
CREATE OR REPLACE FUNCTION app.billing_reconciliation_candidates()
RETURNS TABLE (tenant_id uuid, subscription_id uuid, status public.subscription_status, current_period_end timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT s.tenant_id, s.id, s.status, s.current_period_end
  FROM public.subscriptions s
  WHERE s.plan <> 'free'
    AND (
      s.status = 'past_due'
      OR (s.status = 'active' AND s.current_period_end IS NOT NULL AND s.current_period_end < now() - interval '2 days')
    );
$$;
--> statement-breakpoint
ALTER FUNCTION app.billing_reconciliation_candidates() OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.billing_reconciliation_candidates() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.billing_reconciliation_candidates() TO app_rw;
