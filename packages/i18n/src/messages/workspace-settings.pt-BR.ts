/** Configurações do workspace: dados básicos e módulos opcionais (ADR 0017/0054), pt-BR. */
export const workspaceSettingsPtBR = {
  pageTitle: 'Configurações do workspace',
  pageSubtitle: 'Dados básicos e módulos opcionais deste workspace',
  forbidden: 'Você não tem permissão para gerenciar este workspace.',
  name: 'Nome',
  description: 'Descrição',
  icon: 'Ícone',
  color: 'Cor',
  visibility: 'Visibilidade',
  visibilityOptions: {
    open: 'Aberto (qualquer membro pode encontrar)',
    closed: 'Fechado (só por convite)',
  },
  modules: {
    title: 'Módulos opcionais',
    description:
      'Ative os módulos usados por este workspace. O núcleo (boards, itens, colunas, automações) está sempre ativo.',
    items: {
      agile: 'Ágil (sprints, backlog)',
      process: 'Processos (fases, SLA, formulários)',
      schedule: 'Cronograma (Gantt, dependências, caminho crítico)',
      resources: 'Capacidade e timesheet',
      portfolio: 'Portfólio e programas',
      contracts: 'Contratos/OS/UST',
      ai: 'Assistente de IA',
    },
  },
  saved: 'Workspace atualizado.',
};
