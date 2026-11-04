-- CUBE TRACK — 0026: catálogo de permissões do módulo de IA (ADR 0055), usadas desde
-- `provisioning.ts` (papéis `owner`/`admin`/`workspace_admin`/`workspace_member`) — sem estas linhas,
-- provisionar um tenant novo falha (FK de role_permissions.permission_key), mesmo padrão de 0018.
INSERT INTO public.permissions (key, scope, module, description) VALUES
  ('ai.manage', 'tenant', 'ai', 'Configurar provedor, chave, modelo e limites de IA da organização'),
  ('ai.use', 'workspace', 'ai', 'Usar o assistente de IA, criação de item por texto, resumos, descrição e previsões'),
  ('ai.agents.manage', 'workspace', 'ai', 'Criar, editar e excluir agentes de IA configuráveis'),
  ('ai.agents.approve', 'workspace', 'ai', 'Aprovar, rejeitar e reverter execuções propostas por agentes de IA')
ON CONFLICT (key) DO NOTHING;
