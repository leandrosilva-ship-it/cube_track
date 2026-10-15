/**
 * Templates de board embutidos (ADR 0040) e rótulos padrão de colunas de status, nos três idiomas.
 * A API cria o board a partir do template; a interface mostra a prévia (grupos e colunas).
 */

export type TemplateLocale = 'pt-BR' | 'en' | 'es';

export interface TemplateLabel {
  label: string;
  color: string;
  category: 'not_started' | 'in_progress' | 'stuck' | 'done';
}

export interface TemplateColumn {
  key: string;
  type: string;
  title: string;
  width?: number;
  binding?: string;
  settings?: Record<string, unknown>;
  description?: string;
  labels?: TemplateLabel[];
  options?: { label: string; color: string }[];
  isRequired?: boolean;
  /** Obrigatória quando a coluna de status `columnKey` estiver no rótulo de índice `labelIndex`. */
  requiredWhenLabel?: { columnKey: string; labelIndex: number };
}

export interface BoardTemplate {
  key: string;
  kind: 'board' | 'project' | 'process' | 'backlog';
  name: string;
  description: string;
  icon: string;
  groups: { name: string; color: string }[];
  columns: TemplateColumn[];
  /** Coluna de status principal (conclusão do item, "atrasados"). */
  statusColumnKey: string;
  viewName: string;
}

const STATUS_TEXT: Record<TemplateLocale, [string, string, string, string]> = {
  'pt-BR': ['A fazer', 'Em andamento', 'Parado', 'Concluído'],
  en: ['To do', 'Working on it', 'Stuck', 'Done'],
  es: ['Por hacer', 'En curso', 'Detenido', 'Listo'],
};

/** Rótulos padrão de uma nova coluna de status. */
export function defaultStatusLabels(locale: TemplateLocale): TemplateLabel[] {
  const [todo, doing, stuck, done] = STATUS_TEXT[locale];
  return [
    { label: todo, color: '#c4c4c4', category: 'not_started' },
    { label: doing, color: '#fdab3d', category: 'in_progress' },
    { label: stuck, color: '#df2f4a', category: 'stuck' },
    { label: done, color: '#00c875', category: 'done' },
  ];
}

const YES_NO: Record<TemplateLocale, [string, string]> = {
  'pt-BR': ['Sim', 'Não'],
  en: ['Yes', 'No'],
  es: ['Sí', 'No'],
};

function yesNo(locale: TemplateLocale): TemplateLabel[] {
  const [yes, no] = YES_NO[locale];
  return [
    { label: yes, color: '#00c875', category: 'done' },
    { label: no, color: '#c4c4c4', category: 'not_started' },
  ];
}

interface TemplateText {
  view: string;
  blank: {
    name: string;
    description: string;
    group: string;
    status: string;
    owner: string;
    due: string;
  };
  project: {
    name: string;
    description: string;
    groups: [string, string, string];
    status: string;
    owner: string;
    timeline: string;
    priority: string;
    priorities: [string, string, string];
    hours: string;
    progress: string;
  };
  requests: {
    name: string;
    description: string;
    groups: [string, string];
    status: string;
    requester: string;
    email: string;
    received: string;
    category: string;
    categories: [string, string, string];
  };
  serviceOrders: {
    name: string;
    description: string;
    groups: [string, string];
    id: string;
    status: string;
    issued: string;
    sei: string;
    seiHelp: string;
    ust: string;
    unitPrice: string;
    total: string;
    owner: string;
    due: string;
  };
}

const TEXT: Record<TemplateLocale, TemplateText> = {
  'pt-BR': {
    view: 'Tabela principal',
    blank: {
      name: 'Board em branco',
      description: 'Comece do zero com status, responsável e prazo.',
      group: 'Novo grupo',
      status: 'Status',
      owner: 'Responsável',
      due: 'Prazo',
    },
    project: {
      name: 'Projeto',
      description: 'Fases, cronograma, prioridade, horas e progresso.',
      groups: ['Planejamento', 'Execução', 'Encerramento'],
      status: 'Status',
      owner: 'Responsável',
      timeline: 'Cronograma',
      priority: 'Prioridade',
      priorities: ['Alta', 'Média', 'Baixa'],
      hours: 'Horas estimadas',
      progress: 'Progresso',
    },
    requests: {
      name: 'Solicitações',
      description: 'Triagem de pedidos com solicitante, categoria e status.',
      groups: ['Novas solicitações', 'Em atendimento'],
      status: 'Status',
      requester: 'Solicitante',
      email: 'E-mail do solicitante',
      received: 'Recebida em',
      category: 'Categoria',
      categories: ['Dúvida', 'Problema', 'Melhoria'],
    },
    serviceOrders: {
      name: 'Ordens de serviço (UST)',
      description: 'OS com processo SEI, UST e valor calculado por fórmula.',
      groups: ['Em análise', 'Em andamento'],
      id: 'Nº da OS',
      status: 'Status',
      issued: 'OS emitida',
      sei: 'Processo SEI',
      seiHelp: 'Obrigatório quando a OS é emitida.',
      ust: 'UST',
      unitPrice: 'Valor da UST',
      total: 'Valor da OS',
      owner: 'Responsáveis',
      due: 'Término planejado',
    },
  },
  en: {
    view: 'Main table',
    blank: {
      name: 'Blank board',
      description: 'Start from scratch with status, owner and due date.',
      group: 'New group',
      status: 'Status',
      owner: 'Owner',
      due: 'Due date',
    },
    project: {
      name: 'Project',
      description: 'Phases, timeline, priority, hours and progress.',
      groups: ['Planning', 'Execution', 'Closing'],
      status: 'Status',
      owner: 'Owner',
      timeline: 'Timeline',
      priority: 'Priority',
      priorities: ['High', 'Medium', 'Low'],
      hours: 'Estimated hours',
      progress: 'Progress',
    },
    requests: {
      name: 'Requests',
      description: 'Request triage with requester, category and status.',
      groups: ['New requests', 'In progress'],
      status: 'Status',
      requester: 'Requester',
      email: 'Requester e-mail',
      received: 'Received on',
      category: 'Category',
      categories: ['Question', 'Issue', 'Improvement'],
    },
    serviceOrders: {
      name: 'Service orders (UST)',
      description: 'Service orders with process number, UST and a formula-based amount.',
      groups: ['Under review', 'In progress'],
      id: 'SO number',
      status: 'Status',
      issued: 'SO issued',
      sei: 'Process number',
      seiHelp: 'Required when the service order is issued.',
      ust: 'UST',
      unitPrice: 'UST price',
      total: 'SO amount',
      owner: 'Owners',
      due: 'Planned end',
    },
  },
  es: {
    view: 'Tabla principal',
    blank: {
      name: 'Tablero en blanco',
      description: 'Empiece desde cero con estado, responsable y fecha límite.',
      group: 'Nuevo grupo',
      status: 'Estado',
      owner: 'Responsable',
      due: 'Fecha límite',
    },
    project: {
      name: 'Proyecto',
      description: 'Fases, cronograma, prioridad, horas y progreso.',
      groups: ['Planificación', 'Ejecución', 'Cierre'],
      status: 'Estado',
      owner: 'Responsable',
      timeline: 'Cronograma',
      priority: 'Prioridad',
      priorities: ['Alta', 'Media', 'Baja'],
      hours: 'Horas estimadas',
      progress: 'Progreso',
    },
    requests: {
      name: 'Solicitudes',
      description: 'Clasificación de pedidos con solicitante, categoría y estado.',
      groups: ['Nuevas solicitudes', 'En atención'],
      status: 'Estado',
      requester: 'Solicitante',
      email: 'Correo del solicitante',
      received: 'Recibida el',
      category: 'Categoría',
      categories: ['Duda', 'Problema', 'Mejora'],
    },
    serviceOrders: {
      name: 'Órdenes de servicio (UST)',
      description: 'OS con número de proceso, UST y valor calculado por fórmula.',
      groups: ['En análisis', 'En curso'],
      id: 'N.º de OS',
      status: 'Estado',
      issued: 'OS emitida',
      sei: 'Número de proceso',
      seiHelp: 'Obligatorio cuando se emite la OS.',
      ust: 'UST',
      unitPrice: 'Valor de la UST',
      total: 'Valor de la OS',
      owner: 'Responsables',
      due: 'Fin planificado',
    },
  },
};

export const BOARD_TEMPLATE_KEYS = ['blank', 'project', 'requests', 'service_orders'] as const;
export type BoardTemplateKey = (typeof BOARD_TEMPLATE_KEYS)[number];

export function boardTemplates(locale: TemplateLocale): BoardTemplate[] {
  const text = TEXT[locale];
  const status = defaultStatusLabels(locale);
  const { blank, project, requests, serviceOrders } = text;
  return [
    {
      key: 'blank',
      kind: 'board',
      name: blank.name,
      description: blank.description,
      icon: 'layout-grid',
      groups: [{ name: blank.group, color: '#579bfc' }],
      columns: [
        { key: 'c_status', type: 'status', title: blank.status, width: 140, labels: status },
        { key: 'c_owner', type: 'people', title: blank.owner, width: 140 },
        {
          key: 'c_due',
          type: 'date',
          title: blank.due,
          width: 130,
          binding: 'item.planned_end_date',
        },
      ],
      statusColumnKey: 'c_status',
      viewName: text.view,
    },
    {
      key: 'project',
      kind: 'project',
      name: project.name,
      description: project.description,
      icon: 'briefcase',
      groups: [
        { name: project.groups[0], color: '#579bfc' },
        { name: project.groups[1], color: '#fdab3d' },
        { name: project.groups[2], color: '#00c875' },
      ],
      columns: [
        { key: 'c_status', type: 'status', title: project.status, width: 140, labels: status },
        { key: 'c_owner', type: 'people', title: project.owner, width: 140 },
        { key: 'c_timeline', type: 'timeline', title: project.timeline, width: 180 },
        {
          key: 'c_priority',
          type: 'dropdown',
          title: project.priority,
          width: 120,
          settings: { multiple: false },
          options: [
            { label: project.priorities[0], color: '#df2f4a' },
            { label: project.priorities[1], color: '#fdab3d' },
            { label: project.priorities[2], color: '#579bfc' },
          ],
        },
        {
          key: 'c_hours',
          type: 'number',
          title: project.hours,
          width: 120,
          settings: { unit: 'h', unitPosition: 'suffix', decimals: 1, aggregate: 'sum' },
        },
        {
          key: 'c_progress',
          type: 'progress',
          title: project.progress,
          width: 140,
          settings: { mode: 'status_columns', sourceColumnKeys: ['c_status'] },
        },
      ],
      statusColumnKey: 'c_status',
      viewName: text.view,
    },
    {
      key: 'requests',
      kind: 'process',
      name: requests.name,
      description: requests.description,
      icon: 'inbox',
      groups: [
        { name: requests.groups[0], color: '#a25ddc' },
        { name: requests.groups[1], color: '#fdab3d' },
      ],
      columns: [
        { key: 'c_status', type: 'status', title: requests.status, width: 140, labels: status },
        {
          key: 'c_requester',
          type: 'text',
          title: requests.requester,
          width: 160,
          isRequired: true,
        },
        { key: 'c_email', type: 'email', title: requests.email, width: 200 },
        { key: 'c_received', type: 'date', title: requests.received, width: 130 },
        {
          key: 'c_category',
          type: 'dropdown',
          title: requests.category,
          width: 130,
          settings: { multiple: false },
          options: [
            { label: requests.categories[0], color: '#579bfc' },
            { label: requests.categories[1], color: '#df2f4a' },
            { label: requests.categories[2], color: '#00c875' },
          ],
        },
      ],
      statusColumnKey: 'c_status',
      viewName: text.view,
    },
    {
      key: 'service_orders',
      kind: 'board',
      name: serviceOrders.name,
      description: serviceOrders.description,
      icon: 'file-text',
      groups: [
        { name: serviceOrders.groups[0], color: '#579bfc' },
        { name: serviceOrders.groups[1], color: '#fdab3d' },
      ],
      columns: [
        {
          key: 'c_id',
          type: 'auto_id',
          title: serviceOrders.id,
          width: 120,
          settings: { mask: 'OS-{YYYY}-{SEQ:4}', resetPeriod: 'yearly', applyToSubitems: false },
        },
        {
          key: 'c_status',
          type: 'status',
          title: serviceOrders.status,
          width: 140,
          labels: status,
        },
        {
          key: 'c_os_emitida',
          type: 'status',
          title: serviceOrders.issued,
          width: 120,
          labels: yesNo(locale),
        },
        {
          key: 'c_sei',
          type: 'text',
          title: serviceOrders.sei,
          width: 170,
          description: serviceOrders.seiHelp,
          requiredWhenLabel: { columnKey: 'c_os_emitida', labelIndex: 0 },
        },
        {
          key: 'c_ust',
          type: 'number',
          title: serviceOrders.ust,
          width: 110,
          settings: { unit: 'UST', unitPosition: 'suffix', decimals: 2, aggregate: 'sum' },
        },
        {
          key: 'c_valor_ust',
          type: 'number',
          title: serviceOrders.unitPrice,
          width: 120,
          settings: { unit: 'R$', unitPosition: 'prefix', decimals: 2 },
        },
        {
          key: 'c_valor_os',
          type: 'formula',
          title: serviceOrders.total,
          width: 140,
          settings: {
            expression: 'ROUND({c_ust} * {c_valor_ust}, 2)',
            unit: 'R$',
            unitPosition: 'prefix',
            decimals: 2,
          },
        },
        { key: 'c_owner', type: 'people', title: serviceOrders.owner, width: 150 },
        {
          key: 'c_due',
          type: 'date',
          title: serviceOrders.due,
          width: 130,
          binding: 'item.planned_end_date',
        },
      ],
      statusColumnKey: 'c_status',
      viewName: text.view,
    },
  ];
}

export function isBoardTemplateKey(value: string): value is BoardTemplateKey {
  return (BOARD_TEMPLATE_KEYS as readonly string[]).includes(value);
}
