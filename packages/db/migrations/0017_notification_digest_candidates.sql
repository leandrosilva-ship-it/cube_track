-- Custom SQL migration file, put your code below! --

-- CUBE TRACK — 0017 candidatos de digest de notificação por e-mail para a rotina periódica do
-- worker (ADR 0051). O papel da aplicação não lista tenants/usuários entre tenants (RLS): a função
-- expõe apenas os pares (tenant, usuário) com alguma preferência de e-mail na cadência pedida e ao
-- menos uma notificação ainda não enviada, sem outros dados de negócio. O casamento aqui é
-- aproximado (não resolve a precedência "evento específico > `*`"): o worker refaz a resolução
-- exata por usuário dentro da transação do tenant, evitando duplicar essa lógica em SQL.
CREATE OR REPLACE FUNCTION app.notification_digest_candidates(p_cadence text)
RETURNS TABLE (tenant_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, app AS $$
  SELECT DISTINCT np.tenant_id, np.user_id
  FROM public.notification_preferences np
  WHERE np.channel = 'email'
    AND np.frequency = p_cadence::notification_frequency
    AND np.enabled
    AND EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.tenant_id = np.tenant_id
        AND n.user_id = np.user_id
        AND n.email_sent_at IS NULL
        AND n.read_at IS NULL
    );
$$;
--> statement-breakpoint
ALTER FUNCTION app.notification_digest_candidates(text) OWNER TO platform_admin;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.notification_digest_candidates(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.notification_digest_candidates(text) TO app_rw;
