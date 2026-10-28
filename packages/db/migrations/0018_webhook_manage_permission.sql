-- CUBE TRACK — 0018: catálogo de permissões estava sem `webhook.manage` (ADR 0051), usado pelo papel
-- `board_owner` desde o módulo de webhooks — sem esta linha, provisionar um tenant novo falha
-- (FK de role_permissions.permission_key).
INSERT INTO public.permissions (key, scope, module, description) VALUES
  ('webhook.manage', 'board', 'core', 'Gerenciar webhooks de saída do board')
ON CONFLICT (key) DO NOTHING;
