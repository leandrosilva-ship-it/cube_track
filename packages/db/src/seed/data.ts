/**
 * Dados de demonstração — caso de referência PMSP (consultoria para órgãos públicos medida em UST).
 * Todos os nomes de pessoas e e-mails são fictícios.
 */

export interface DemoUser {
  key: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
  jobTitle: string;
  department: string;
  costRateHour: string;
  skills: [string, number][];
}

export const DEMO_USERS: readonly DemoUser[] = [
  {
    key: 'ana',
    name: 'Ana Paula Ribeiro',
    email: 'ana.ribeiro@empresademo.com.br',
    role: 'owner',
    jobTitle: 'Diretora de Operações',
    department: 'Diretoria',
    costRateHour: '210.0000',
    skills: [['Gestão de contratos', 5]],
  },
  {
    key: 'carlos',
    name: 'Carlos Eduardo Lima',
    email: 'carlos.lima@empresademo.com.br',
    role: 'admin',
    jobTitle: 'Coordenador do PMO',
    department: 'PMO',
    costRateHour: '165.0000',
    skills: [
      ['Gestão de contratos', 4],
      ['Gestão de projetos', 5],
    ],
  },
  {
    key: 'fernanda',
    name: 'Fernanda Souza',
    email: 'fernanda.souza@empresademo.com.br',
    role: 'member',
    jobTitle: 'Gerente de Projetos',
    department: 'PMO',
    costRateHour: '140.0000',
    skills: [
      ['Gestão de projetos', 5],
      ['BPMN', 3],
    ],
  },
  {
    key: 'rafael',
    name: 'Rafael Mendes',
    email: 'rafael.mendes@empresademo.com.br',
    role: 'member',
    jobTitle: 'Analista de Processos',
    department: 'Processos',
    costRateHour: '110.0000',
    skills: [
      ['BPMN', 5],
      ['SIGRC', 4],
      ['UX Research', 2],
    ],
  },
  {
    key: 'juliana',
    name: 'Juliana Castro',
    email: 'juliana.castro@empresademo.com.br',
    role: 'member',
    jobTitle: 'Desenvolvedora Full-Stack',
    department: 'Desenvolvimento',
    costRateHour: '125.0000',
    skills: [
      ['React', 5],
      ['Integrações REST', 4],
      ['SEI', 3],
    ],
  },
  {
    key: 'bruno',
    name: 'Bruno Oliveira',
    email: 'bruno.oliveira@empresademo.com.br',
    role: 'member',
    jobTitle: 'Desenvolvedor de BI',
    department: 'Dados',
    costRateHour: '120.0000',
    skills: [
      ['Power BI', 5],
      ['SQL', 5],
      ['API Creator', 3],
    ],
  },
  {
    key: 'mariana',
    name: 'Mariana Alves',
    email: 'mariana.alves@empresademo.com.br',
    role: 'member',
    jobTitle: 'UX Designer',
    department: 'Design',
    costRateHour: '115.0000',
    skills: [
      ['UX Research', 5],
      ['Prototipação', 5],
    ],
  },
  {
    key: 'thiago',
    name: 'Thiago Pereira',
    email: 'thiago.pereira@empresademo.com.br',
    role: 'viewer',
    jobTitle: 'Analista Financeiro',
    department: 'Financeiro',
    costRateHour: '95.0000',
    skills: [],
  },
  {
    key: 'patricia',
    name: 'Patrícia Gomes',
    email: 'patricia.gomes@cliente.exemplo.gov.br',
    role: 'guest',
    jobTitle: 'Fiscal do contrato (SMIT)',
    department: 'Cliente',
    costRateHour: '0.0000',
    skills: [],
  },
];

export const DEMO_TEAMS = [
  { name: 'PMO', members: ['carlos', 'fernanda'], lead: 'carlos' },
  { name: 'Desenvolvimento', members: ['juliana', 'bruno'], lead: 'juliana' },
  { name: 'Processos e UX', members: ['rafael', 'mariana'], lead: 'rafael' },
] as const;

export const FOLDERS = [
  'Implantações Concluídas',
  'Sustentação',
  'Projetos Concluídos',
  'Demandas internas',
  'Templates',
] as const;

export const FRENTES = [
  { label: 'Aplicativo', color: '#a25ddc' },
  { label: 'SIGRC', color: '#0086c0' },
  { label: 'Integração', color: '#037f4c' },
  { label: 'Formulário', color: '#fdab3d' },
  { label: 'Mapeamento e Redesenho', color: '#e2445c' },
  { label: 'Portal', color: '#579bfc' },
  { label: 'BI', color: '#ff642e' },
] as const;
export type Frente = (typeof FRENTES)[number]['label'];

export const ORGAOS = ['SMIT', 'COHAB', 'OGM', 'Ouvidoria SUS', 'SMPED'] as const;
export type Orgao = (typeof ORGAOS)[number];

export const TIPOS = [
  { label: 'Nova funcionalidade', color: '#00c875' },
  { label: 'Evolutiva', color: '#579bfc' },
  { label: 'Corretiva', color: '#e2445c' },
  { label: 'Diagnóstico', color: '#a25ddc' },
  { label: 'Sustentação', color: '#808080' },
] as const;
export type Tipo = (typeof TIPOS)[number]['label'];

export const STATUS_LABELS = [
  { label: 'Não iniciado', color: '#c4c4c4', category: 'not_started' },
  { label: 'Em andamento', color: '#fdab3d', category: 'in_progress' },
  { label: 'Aguardando cliente', color: '#9cd326', category: 'in_progress' },
  { label: 'Em homologação', color: '#0086c0', category: 'in_progress' },
  { label: 'Parado', color: '#e2445c', category: 'stuck' },
  { label: 'Concluído', color: '#00c875', category: 'done' },
] as const;
export type StatusLabel = (typeof STATUS_LABELS)[number]['label'];

export const SIM_NAO = [
  { label: 'Sim', color: '#00c875', category: 'done' },
  { label: 'Não', color: '#e2445c', category: 'not_started' },
  { label: 'Não se aplica', color: '#c4c4c4', category: 'not_started' },
] as const;

/** Catálogo do edital: código, serviço e UST padrão por unidade. */
export const CATALOG = [
  { code: 'D1', name: 'Diagnóstico', ust: '40.0000', category: 'Descoberta' },
  { code: 'D2', name: 'Pesquisa', ust: '32.0000', category: 'Descoberta' },
  {
    code: 'D3',
    name: 'Mapear e propor redesenho de serviço',
    ust: '60.0000',
    category: 'Descoberta',
  },
  { code: 'D4', name: 'Prototipação', ust: '48.0000', category: 'Desenvolvimento' },
  { code: 'D6', name: 'Parametrização', ust: '24.0000', category: 'Desenvolvimento' },
  { code: 'D7', name: 'Disponibilização', ust: '16.0000', category: 'Entrega' },
  { code: 'D9', name: 'Operação assistida', ust: '20.0000', category: 'Entrega' },
  { code: 'CP1', name: 'Alterações de design', ust: '12.0000', category: 'Change request' },
  { code: 'CP2', name: 'Alterações para melhoria', ust: '16.0000', category: 'Change request' },
  { code: 'CP5', name: 'Inclusão', ust: '8.0000', category: 'Change request' },
  { code: 'M3', name: 'Ajustes', ust: '6.0000', category: 'Manutenção' },
  { code: 'M5', name: 'Ajustes e melhorias', ust: '10.0000', category: 'Manutenção' },
] as const;
export type CatalogCode = (typeof CATALOG)[number]['code'];

export type DemandGroup = 'analise' | 'andamento' | 'concluida';

export interface DemandSpec {
  orgao: Orgao;
  frente: Frente;
  name: string;
  group: DemandGroup;
  tipo: Tipo;
  /** Serviços do catálogo e quantidade. */
  services: [CatalogCode, number][];
  /** Chaves dos responsáveis (DEMO_USERS.key). */
  owners: string[];
}

const d = (
  orgao: Orgao,
  frente: Frente,
  name: string,
  group: DemandGroup,
  tipo: Tipo,
  services: [CatalogCode, number][],
  owners: string[],
): DemandSpec => ({ orgao, frente, name, group, tipo, services, owners });

/** 60 demandas do board PMSP. */
export const DEMANDS: readonly DemandSpec[] = [
  // Demandas em Análise (15)
  d(
    'SMIT',
    'Integração',
    'SMIT - SEI – Integração com protocolo digital',
    'analise',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D4', 1],
    ],
    ['juliana', 'rafael'],
  ),
  d(
    'COHAB',
    'SIGRC',
    'COHAB - SIGRC - Renegociação de dívidas de mutuários',
    'analise',
    'Nova funcionalidade',
    [
      ['D3', 1],
      ['D6', 2],
    ],
    ['rafael'],
  ),
  d(
    'OGM',
    'Portal',
    'OGM - Portal - Página de transparência de recomendações',
    'analise',
    'Evolutiva',
    [
      ['D4', 1],
      ['D7', 1],
    ],
    ['mariana', 'juliana'],
  ),
  d(
    'Ouvidoria SUS',
    'BI',
    'Ouvidoria SUS - Painel de manifestações por região de saúde',
    'analise',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 1],
    ],
    ['bruno'],
  ),
  d(
    'SMPED',
    'Formulário',
    'SMPED - Formulário - Solicitação de cadeira de rodas motorizada',
    'analise',
    'Nova funcionalidade',
    [
      ['D3', 1],
      ['D4', 1],
    ],
    ['mariana', 'rafael'],
  ),
  d(
    'SMIT',
    'Mapeamento e Redesenho',
    'SMIT - Mapeamento - Processo de concessão de alvarás',
    'analise',
    'Diagnóstico',
    [
      ['D1', 1],
      ['D3', 1],
    ],
    ['rafael'],
  ),
  d(
    'COHAB',
    'Aplicativo',
    'COHAB - Aplicativo - Segunda via de boleto no app',
    'analise',
    'Evolutiva',
    [['CP2', 2]],
    ['juliana'],
  ),
  d(
    'OGM',
    'Integração',
    'OGM - Integração - Webservice com Controladoria Geral',
    'analise',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 1],
    ],
    ['juliana'],
  ),
  d(
    'Ouvidoria SUS',
    'SIGRC',
    'Ouvidoria SUS - SIGRC - Classificação automática de manifestações',
    'analise',
    'Nova funcionalidade',
    [
      ['D2', 1],
      ['D6', 1],
    ],
    ['rafael', 'bruno'],
  ),
  d(
    'SMPED',
    'Portal',
    'SMPED - Portal - Acessibilidade WCAG das páginas de serviços',
    'analise',
    'Corretiva',
    [['CP1', 3]],
    ['mariana'],
  ),
  d(
    'SMIT',
    'BI',
    'SMIT - BI - Indicadores de tempo de atendimento SEI',
    'analise',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 1],
    ],
    ['bruno'],
  ),
  d(
    'COHAB',
    'Formulário',
    'COHAB - Formulário - Atualização cadastral de mutuários',
    'analise',
    'Evolutiva',
    [
      ['CP5', 2],
      ['CP2', 1],
    ],
    ['rafael'],
  ),
  d(
    'OGM',
    'Mapeamento e Redesenho',
    'OGM - Mapeamento - Fluxo de tratamento de denúncias',
    'analise',
    'Diagnóstico',
    [['D3', 1]],
    ['rafael', 'mariana'],
  ),
  d(
    'Ouvidoria SUS',
    'Aplicativo',
    'Ouvidoria SUS - Aplicativo - Notificações push de protocolo',
    'analise',
    'Nova funcionalidade',
    [['D4', 1]],
    ['juliana'],
  ),
  d(
    'SMPED',
    'Integração',
    'SMPED - Integração - Cadastro único da pessoa com deficiência',
    'analise',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D2', 1],
    ],
    ['juliana', 'rafael'],
  ),
  // Demandas em Andamento (25)
  d(
    'SMIT',
    'Integração',
    'SMIT - SEI – Redesenho Integração SEI',
    'andamento',
    'Evolutiva',
    [
      ['D3', 1],
      ['D6', 2],
      ['D7', 1],
    ],
    ['juliana', 'rafael'],
  ),
  d(
    'COHAB',
    'SIGRC',
    'COHAB - SIGRC - Transferência de titularidade do imóvel',
    'andamento',
    'Nova funcionalidade',
    [
      ['D3', 1],
      ['D6', 2],
      ['D7', 1],
    ],
    ['rafael', 'juliana'],
  ),
  d(
    'OGM',
    'Portal',
    'OGM - Portal - Aba OGM',
    'andamento',
    'Evolutiva',
    [
      ['D4', 1],
      ['D7', 1],
    ],
    ['mariana', 'juliana'],
  ),
  d(
    'Ouvidoria SUS',
    'BI',
    'Ouvidoria SUS - 23ª Atualização de base de dados, API Creator',
    'andamento',
    'Sustentação',
    [['M5', 2]],
    ['bruno'],
  ),
  d(
    'SMPED',
    'Formulário',
    'SMPED - Formulário - Inscrição no programa Bolsa Acessibilidade',
    'andamento',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D6', 1],
      ['D7', 1],
    ],
    ['mariana', 'rafael'],
  ),
  d(
    'SMIT',
    'Aplicativo',
    'SMIT - Aplicativo - Login com gov.br',
    'andamento',
    'Evolutiva',
    [
      ['D6', 1],
      ['D7', 1],
    ],
    ['juliana'],
  ),
  d(
    'COHAB',
    'BI',
    'COHAB - BI - Painel de inadimplência por empreendimento',
    'andamento',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 2],
    ],
    ['bruno'],
  ),
  d(
    'OGM',
    'SIGRC',
    'OGM - SIGRC - Módulo de recomendações de auditoria',
    'andamento',
    'Nova funcionalidade',
    [
      ['D3', 1],
      ['D6', 2],
    ],
    ['rafael', 'juliana'],
  ),
  d(
    'Ouvidoria SUS',
    'Integração',
    'Ouvidoria SUS - Integração - Barramento com Ouvidor SUS federal',
    'andamento',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 2],
      ['D7', 1],
    ],
    ['juliana'],
  ),
  d(
    'SMPED',
    'Mapeamento e Redesenho',
    'SMPED - Mapeamento - Jornada do Atende+ (transporte especial)',
    'andamento',
    'Diagnóstico',
    [
      ['D2', 1],
      ['D3', 1],
    ],
    ['rafael', 'mariana'],
  ),
  d(
    'SMIT',
    'Portal',
    'SMIT - Portal - Catálogo de serviços digitais',
    'andamento',
    'Evolutiva',
    [
      ['D4', 1],
      ['CP2', 2],
    ],
    ['mariana', 'juliana'],
  ),
  d(
    'COHAB',
    'Aplicativo',
    'COHAB - Aplicativo - Agendamento de vistorias',
    'andamento',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D6', 1],
    ],
    ['juliana', 'mariana'],
  ),
  d(
    'OGM',
    'BI',
    'OGM - BI - Indicadores de integridade das secretarias',
    'andamento',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 1],
    ],
    ['bruno'],
  ),
  d(
    'Ouvidoria SUS',
    'Formulário',
    'Ouvidoria SUS - Formulário - Pesquisa de satisfação pós-atendimento',
    'andamento',
    'Evolutiva',
    [
      ['CP5', 3],
      ['D7', 1],
    ],
    ['mariana'],
  ),
  d(
    'SMPED',
    'SIGRC',
    'SMPED - SIGRC - Gestão de laudos médicos',
    'andamento',
    'Nova funcionalidade',
    [
      ['D3', 1],
      ['D6', 1],
    ],
    ['rafael'],
  ),
  d(
    'SMIT',
    'Mapeamento e Redesenho',
    'SMIT - Mapeamento - Redesenho do processo de compras',
    'andamento',
    'Diagnóstico',
    [
      ['D1', 1],
      ['D3', 1],
    ],
    ['rafael', 'fernanda'],
  ),
  d(
    'COHAB',
    'Portal',
    'COHAB - Portal - Área do mutuário',
    'andamento',
    'Evolutiva',
    [
      ['D4', 1],
      ['D7', 1],
    ],
    ['mariana', 'juliana'],
  ),
  d(
    'OGM',
    'Formulário',
    'OGM - Formulário - Canal de denúncia anônima',
    'andamento',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D6', 1],
    ],
    ['mariana', 'rafael'],
  ),
  d(
    'Ouvidoria SUS',
    'SIGRC',
    'Ouvidoria SUS - SIGRC - Ajustes no encaminhamento de manifestações',
    'andamento',
    'Corretiva',
    [['M3', 3]],
    ['rafael'],
  ),
  d(
    'SMPED',
    'BI',
    'SMPED - BI - Mapa de acessibilidade dos equipamentos públicos',
    'andamento',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 1],
    ],
    ['bruno'],
  ),
  d(
    'SMIT',
    'SIGRC',
    'SMIT - SIGRC - Parametrização de SLA por tipo de demanda',
    'andamento',
    'Evolutiva',
    [['D6', 2]],
    ['rafael'],
  ),
  d(
    'COHAB',
    'Integração',
    'COHAB - Integração - Conciliação bancária automática',
    'andamento',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 1],
      ['D7', 1],
    ],
    ['juliana'],
  ),
  d(
    'OGM',
    'Aplicativo',
    'OGM - Aplicativo - Consulta de processos de controle',
    'andamento',
    'Nova funcionalidade',
    [['D4', 1]],
    ['juliana', 'mariana'],
  ),
  d(
    'Ouvidoria SUS',
    'Portal',
    'Ouvidoria SUS - Portal - Nova home da Ouvidoria',
    'andamento',
    'Evolutiva',
    [
      ['CP1', 2],
      ['D7', 1],
    ],
    ['mariana'],
  ),
  d(
    'SMPED',
    'Aplicativo',
    'SMPED - Aplicativo - Carteira digital da pessoa com deficiência',
    'andamento',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D6', 1],
      ['D7', 1],
    ],
    ['juliana', 'mariana'],
  ),
  // Concluídas (20)
  d(
    'SMIT',
    'Integração',
    'SMIT - SEI – Assinatura eletrônica em lote',
    'concluida',
    'Nova funcionalidade',
    [
      ['D6', 1],
      ['D7', 1],
    ],
    ['juliana'],
  ),
  d(
    'COHAB',
    'SIGRC',
    'COHAB - SIGRC - Quitação antecipada de financiamento',
    'concluida',
    'Nova funcionalidade',
    [
      ['D3', 1],
      ['D6', 1],
      ['D7', 1],
    ],
    ['rafael', 'juliana'],
  ),
  d(
    'OGM',
    'Portal',
    'OGM - Portal - Publicação de relatórios de auditoria',
    'concluida',
    'Evolutiva',
    [
      ['D4', 1],
      ['D7', 1],
    ],
    ['mariana'],
  ),
  d(
    'Ouvidoria SUS',
    'BI',
    'Ouvidoria SUS - 22ª Atualização de base de dados, API Creator',
    'concluida',
    'Sustentação',
    [['M5', 2]],
    ['bruno'],
  ),
  d(
    'Ouvidoria SUS',
    'BI',
    'Ouvidoria SUS - 21ª Atualização de base de dados, API Creator',
    'concluida',
    'Sustentação',
    [['M5', 2]],
    ['bruno'],
  ),
  d(
    'SMPED',
    'Formulário',
    'SMPED - Formulário - Solicitação de intérprete de Libras',
    'concluida',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D7', 1],
    ],
    ['mariana', 'rafael'],
  ),
  d(
    'SMIT',
    'Mapeamento e Redesenho',
    'SMIT - Mapeamento - Processo de licenciamento de eventos',
    'concluida',
    'Diagnóstico',
    [
      ['D1', 1],
      ['D3', 1],
    ],
    ['rafael'],
  ),
  d(
    'COHAB',
    'Aplicativo',
    'COHAB - Aplicativo - Extrato do financiamento',
    'concluida',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D7', 1],
    ],
    ['juliana'],
  ),
  d(
    'OGM',
    'SIGRC',
    'OGM - SIGRC - Cadastro de órgãos auditados',
    'concluida',
    'Nova funcionalidade',
    [['D6', 1]],
    ['rafael'],
  ),
  d(
    'Ouvidoria SUS',
    'Integração',
    'Ouvidoria SUS - Integração - Envio de protocolos por e-mail',
    'concluida',
    'Evolutiva',
    [
      ['D6', 1],
      ['D7', 1],
    ],
    ['juliana'],
  ),
  d(
    'SMPED',
    'Portal',
    'SMPED - Portal - Guia de direitos da pessoa com deficiência',
    'concluida',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D7', 1],
    ],
    ['mariana'],
  ),
  d(
    'SMIT',
    'BI',
    'SMIT - BI - Painel de digitalização de serviços',
    'concluida',
    'Nova funcionalidade',
    [
      ['D1', 1],
      ['D6', 1],
    ],
    ['bruno'],
  ),
  d(
    'COHAB',
    'Formulário',
    'COHAB - Formulário - Inscrição em programas habitacionais',
    'concluida',
    'Nova funcionalidade',
    [
      ['D4', 1],
      ['D6', 1],
      ['D7', 1],
    ],
    ['mariana', 'rafael'],
  ),
  d(
    'OGM',
    'Integração',
    'OGM - Integração - Importação de dados do e-SIC',
    'concluida',
    'Nova funcionalidade',
    [
      ['D6', 1],
      ['D7', 1],
    ],
    ['juliana'],
  ),
  d(
    'Ouvidoria SUS',
    'Mapeamento e Redesenho',
    'Ouvidoria SUS - Mapeamento - Fluxo de resposta ao cidadão',
    'concluida',
    'Diagnóstico',
    [
      ['D2', 1],
      ['D3', 1],
    ],
    ['rafael', 'mariana'],
  ),
  d(
    'SMPED',
    'SIGRC',
    'SMPED - SIGRC - Ajustes no cadastro de beneficiários',
    'concluida',
    'Corretiva',
    [['M3', 2]],
    ['rafael'],
  ),
  d(
    'SMIT',
    'Portal',
    'SMIT - Portal - Ajustes de layout responsivo',
    'concluida',
    'Corretiva',
    [['CP1', 2]],
    ['mariana'],
  ),
  d(
    'COHAB',
    'BI',
    'COHAB - BI - Relatório de entregas habitacionais',
    'concluida',
    'Nova funcionalidade',
    [['D6', 1]],
    ['bruno'],
  ),
  d(
    'OGM',
    'Aplicativo',
    'OGM - Aplicativo - Melhorias no fluxo de denúncia',
    'concluida',
    'Evolutiva',
    [
      ['CP2', 2],
      ['D9', 1],
    ],
    ['juliana', 'mariana'],
  ),
  d(
    'SMPED',
    'Integração',
    'SMPED - Integração - Consulta de benefícios no CadÚnico',
    'concluida',
    'Nova funcionalidade',
    [
      ['D6', 1],
      ['D7', 1],
      ['D9', 1],
    ],
    ['juliana'],
  ),
];

/** Textos de atualizações (feed) — `{owner}`/`{guest}` são substituídos por menções. */
export const UPDATE_TEMPLATES = {
  analise: [
    'Recebemos a solicitação do órgão. {owner}, pode avaliar o escopo e estimar as USTs?',
    'Reunião de entendimento agendada com a área demandante. Pauta e ata ficarão anexadas aqui.',
    'Estimativa inicial enviada ao fiscal do contrato para aprovação da OS. {guest}, aguardamos o retorno.',
  ],
  andamento: [
    'OS emitida e kick-off realizado. {owner}, seguimos com o plano de trabalho combinado.',
    'Primeira versão disponível no ambiente de homologação. {guest}, poderia validar com a equipe do órgão?',
    'Identificamos dependência de dados do órgão; prazo replanejado em comum acordo.',
    'Status semanal: atividades dentro do cronograma, sem impedimentos no momento.',
  ],
  concluida: [
    'Entrega homologada pelo órgão. Termo de recebimento anexado. {owner}, obrigado pelo trabalho!',
    'Operação assistida encerrada sem incidentes. Demanda pronta para medição.',
    'Medição aprovada pelo fiscal do contrato e encaminhada para faturamento.',
  ],
} as const;

export const REPLY_TEMPLATES = [
  'Combinado, sigo acompanhando.',
  'Perfeito! Vou atualizar as datas no cronograma.',
  'Validação feita, sem ressalvas.',
  'Anexei as evidências solicitadas.',
] as const;

export const CHECKLIST_TEMPLATES = [
  {
    title: 'Checklist de entrega',
    items: [
      'Validar requisitos com o órgão',
      'Executar testes de regressão',
      'Atualizar documentação',
      'Obter termo de aceite',
    ],
  },
  {
    title: 'Pré-emissão da OS',
    items: ['Estimar USTs pelo catálogo', 'Validar código do edital', 'Enviar minuta ao fiscal'],
  },
] as const;

export const SUBITEM_TEMPLATES = [
  'Levantamento de requisitos',
  'Desenvolvimento',
  'Homologação com o órgão',
] as const;
