-- CUBE TRACK — 0036: GRANTs de `password_history` (ADR 0057) para o papel `app_auth` — tabela GLOBAL
-- (sem tenant_id, mesmo motivo de `users`/`auth_tokens`/`sessions`, 0005), lida/escrita pelo
-- `AuthService` via `IdentityRepository` (conexão `app_auth`), nunca pela conexão de negócio
-- (`app_rw`). Append-only: nenhum UPDATE concedido.

GRANT SELECT, INSERT, DELETE ON public.password_history TO app_auth;
