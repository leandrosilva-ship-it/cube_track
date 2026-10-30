/** Workspace settings: basic details and optional modules (ADR 0017/0054). */
export const workspaceSettingsEn = {
  pageTitle: 'Workspace settings',
  pageSubtitle: 'Basic details and optional modules for this workspace',
  forbidden: 'You do not have permission to manage this workspace.',
  name: 'Name',
  description: 'Description',
  icon: 'Icon',
  color: 'Color',
  visibility: 'Visibility',
  visibilityOptions: {
    open: 'Open (any member can find it)',
    closed: 'Closed (invite only)',
  },
  modules: {
    title: 'Optional modules',
    description:
      'Turn on the modules this workspace uses. The core (boards, items, columns, automations) is always on.',
    items: {
      agile: 'Agile (sprints, backlog)',
      process: 'Processes (phases, SLA, forms)',
      schedule: 'Schedule (Gantt, dependencies, critical path)',
      resources: 'Capacity and timesheet',
      portfolio: 'Portfolio and programs',
      contracts: 'Contracts/Work orders/UST',
      ai: 'AI assistant',
    },
  },
  saved: 'Workspace updated.',
};
