/** Configuración del workspace: datos básicos y módulos opcionales (ADR 0017/0054). */
export const workspaceSettingsEs = {
  pageTitle: 'Configuración del espacio de trabajo',
  pageSubtitle: 'Datos básicos y módulos opcionales de este espacio de trabajo',
  forbidden: 'No tienes permiso para administrar este espacio de trabajo.',
  name: 'Nombre',
  description: 'Descripción',
  icon: 'Ícono',
  color: 'Color',
  visibility: 'Visibilidad',
  visibilityOptions: {
    open: 'Abierto (cualquier miembro puede encontrarlo)',
    closed: 'Cerrado (solo por invitación)',
  },
  modules: {
    title: 'Módulos opcionales',
    description:
      'Activa los módulos que usa este espacio de trabajo. El núcleo (tableros, ítems, columnas, automatizaciones) siempre está activo.',
    items: {
      agile: 'Ágil (sprints, backlog)',
      process: 'Procesos (fases, SLA, formularios)',
      schedule: 'Cronograma (Gantt, dependencias, ruta crítica)',
      resources: 'Capacidad y hoja de horas',
      portfolio: 'Portafolio y programas',
      contracts: 'Contratos/Órdenes de servicio/UST',
      ai: 'Asistente de IA',
    },
  },
  saved: 'Espacio de trabajo actualizado.',
};
