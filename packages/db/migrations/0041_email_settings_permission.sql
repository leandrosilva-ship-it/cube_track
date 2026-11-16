-- CUBE PROJECT — 0041: catálogo da permissão de SMTP por tenant, usada desde `provisioning.ts`
-- (papéis `owner`/`admin`) — sem esta linha, provisionar um tenant novo falha (FK de
-- role_permissions.permission_key), mesmo padrão de 0026.
INSERT INTO public.permissions (key, scope, module, description) VALUES
  ('email.manage', 'tenant', 'email', 'Configurar o SMTP próprio da organização (host, porta, usuário, senha, remetente)')
ON CONFLICT (key) DO NOTHING;
