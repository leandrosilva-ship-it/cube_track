-- CUBE TRACK — 0003 dados de referência globais
-- Catálogo de permissões e feriados brasileiros (nacionais + estado/município de São Paulo).
-- Feriados de outras UFs/municípios são carregados pelo mesmo mecanismo (ADR 0019).

INSERT INTO public.permissions (key, scope, module, description) VALUES
  ('tenant.manage', 'tenant', 'core', 'Gerenciar configurações da organização'),
  ('tenant.billing', 'tenant', 'core', 'Gerenciar plano e faturamento'),
  ('members.invite', 'tenant', 'core', 'Convidar membros e convidados'),
  ('members.manage', 'tenant', 'core', 'Gerenciar membros, papéis e acessos'),
  ('teams.manage', 'tenant', 'core', 'Gerenciar times'),
  ('roles.manage', 'tenant', 'core', 'Gerenciar papéis customizados'),
  ('audit.read', 'tenant', 'core', 'Consultar trilha de auditoria'),
  ('api_tokens.manage', 'tenant', 'core', 'Gerenciar tokens de API e webhooks'),
  ('templates.manage', 'tenant', 'core', 'Gerenciar templates da organização'),
  ('workspace.create', 'tenant', 'core', 'Criar workspaces'),
  ('workspace.read', 'workspace', 'core', 'Acessar o workspace'),
  ('workspace.manage', 'workspace', 'core', 'Gerenciar workspace, módulos e membros'),
  ('folder.manage', 'workspace', 'core', 'Criar e organizar pastas'),
  ('board.create', 'workspace', 'core', 'Criar boards'),
  ('dashboard.create', 'workspace', 'core', 'Criar dashboards'),
  ('portfolio.manage', 'workspace', 'portfolio', 'Gerenciar portfólios e programas'),
  ('portfolio.read', 'workspace', 'portfolio', 'Visualizar portfólios e programas'),
  ('resources.manage', 'workspace', 'resources', 'Gerenciar alocações e capacidade'),
  ('timesheet.approve', 'workspace', 'resources', 'Aprovar timesheets'),
  ('contract.read', 'workspace', 'contracts', 'Visualizar contratos, OS e medições'),
  ('contract.manage', 'workspace', 'contracts', 'Gerenciar contratos, catálogo e OS'),
  ('contract.measure', 'workspace', 'contracts', 'Registrar e aprovar medições e faturas'),
  ('board.read', 'board', 'core', 'Visualizar o board'),
  ('board.manage', 'board', 'core', 'Gerenciar configurações do board'),
  ('board.share', 'board', 'core', 'Compartilhar o board e criar links públicos'),
  ('board.export', 'board', 'core', 'Exportar dados do board'),
  ('column.manage', 'board', 'core', 'Criar, editar e excluir colunas'),
  ('group.manage', 'board', 'core', 'Criar, editar e excluir grupos'),
  ('view.manage', 'board', 'core', 'Criar e editar views compartilhadas'),
  ('item.create', 'board', 'core', 'Criar itens'),
  ('item.update', 'board', 'core', 'Editar qualquer item'),
  ('item.update_assigned', 'board', 'core', 'Editar itens em que é responsável'),
  ('item.delete', 'board', 'core', 'Excluir e arquivar itens'),
  ('item.comment', 'board', 'core', 'Publicar atualizações e respostas'),
  ('file.upload', 'board', 'core', 'Enviar arquivos'),
  ('automation.manage', 'board', 'core', 'Gerenciar automações do board'),
  ('form.manage', 'board', 'core', 'Gerenciar formulários do board'),
  ('timesheet.log', 'board', 'resources', 'Apontar horas nos itens'),
  ('schedule.manage', 'board', 'schedule', 'Gerenciar dependências e baselines'),
  ('process.manage', 'board', 'process', 'Gerenciar fases, transições e SLAs')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
CREATE OR REPLACE FUNCTION app.easter_sunday(p_year integer) RETURNS date
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
  v_month int := (h + l - 7 * m + 114) / 31;
  v_day int := ((h + l - 7 * m + 114) % 31) + 1;
BEGIN
  RETURN make_date(p_year, v_month, v_day);
END
$$;
--> statement-breakpoint

-- Carrega feriados globais (tenant_id nulo) para um intervalo de anos. Idempotente.
CREATE OR REPLACE FUNCTION app.load_brazilian_holidays(p_from integer, p_to integer) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  y int;
  v_easter date;
  v_count int := 0;
  v_rows int;
BEGIN
  FOR y IN p_from .. p_to LOOP
    v_easter := app.easter_sunday(y);
    INSERT INTO public.holidays (date, name, scope, state_code, city_ibge_code, is_optional)
    SELECT h.date, h.name, h.scope::public.holiday_scope, h.state_code, h.city_ibge_code, h.is_optional
    FROM (VALUES
      (make_date(y, 1, 1), 'Confraternização Universal', 'national', NULL, NULL, false),
      (v_easter - 48, 'Carnaval (segunda-feira)', 'national', NULL, NULL, true),
      (v_easter - 47, 'Carnaval (terça-feira)', 'national', NULL, NULL, true),
      (v_easter - 46, 'Quarta-feira de Cinzas (até 14h)', 'national', NULL, NULL, true),
      (v_easter - 2, 'Sexta-feira Santa', 'national', NULL, NULL, false),
      (make_date(y, 4, 21), 'Tiradentes', 'national', NULL, NULL, false),
      (make_date(y, 5, 1), 'Dia do Trabalho', 'national', NULL, NULL, false),
      (v_easter + 60, 'Corpus Christi', 'national', NULL, NULL, true),
      (make_date(y, 9, 7), 'Independência do Brasil', 'national', NULL, NULL, false),
      (make_date(y, 10, 12), 'Nossa Senhora Aparecida', 'national', NULL, NULL, false),
      (make_date(y, 10, 28), 'Dia do Servidor Público', 'national', NULL, NULL, true),
      (make_date(y, 11, 2), 'Finados', 'national', NULL, NULL, false),
      (make_date(y, 11, 15), 'Proclamação da República', 'national', NULL, NULL, false),
      (make_date(y, 11, 20), 'Dia Nacional de Zumbi e da Consciência Negra', 'national', NULL, NULL, false),
      (make_date(y, 12, 25), 'Natal', 'national', NULL, NULL, false),
      (make_date(y, 7, 9), 'Revolução Constitucionalista', 'state', 'SP', NULL, false),
      (make_date(y, 1, 25), 'Aniversário da Cidade de São Paulo', 'municipal', 'SP', '3550308', false),
      (v_easter + 60, 'Corpus Christi (feriado municipal)', 'municipal', 'SP', '3550308', false)
    ) AS h(date, name, scope, state_code, city_ibge_code, is_optional)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.holidays x
      WHERE x.tenant_id IS NULL AND x.date = h.date AND x.name = h.name
    );
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count + v_rows;
  END LOOP;
  RETURN v_count;
END
$$;
--> statement-breakpoint
SELECT app.load_brazilian_holidays(2024, 2035);
--> statement-breakpoint

-- Dias úteis entre duas datas (inclusive) para um calendário de trabalho do tenant corrente.
CREATE OR REPLACE FUNCTION app.business_days_between(p_calendar_id uuid, p_from date, p_to date) RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
  FROM generate_series(p_from, p_to, interval '1 day') AS g(day)
  JOIN public.work_calendars c ON c.id = p_calendar_id
  WHERE extract(isodow FROM g.day)::smallint = ANY (c.working_days)
    AND NOT EXISTS (
      SELECT 1 FROM public.holidays h
      WHERE h.date = g.day::date
        AND h.deleted_at IS NULL
        AND NOT h.is_optional
        AND (
          (h.tenant_id IS NULL AND (
            h.scope = 'national'
            OR (h.scope = 'state' AND h.state_code = c.state_code)
            OR (h.scope = 'municipal' AND h.city_ibge_code = c.city_ibge_code)))
          OR (h.tenant_id = c.tenant_id AND (h.calendar_id IS NULL OR h.calendar_id = c.id))
        )
    );
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.load_brazilian_holidays(integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.easter_sunday(integer), app.business_days_between(uuid, date, date) TO app_rw, app_ro;
