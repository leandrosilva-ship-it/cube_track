/**
 * Módulos opcionais por workspace (ADR 0017, ADR 0054). `core` é sempre ativo (valor padrão de
 * `workspaces.enabled_modules` no banco) e nunca pode ser removido; os demais são ativáveis por
 * workspace. Lista fechada — um módulo novo (ex.: Prompt 14, `ai`) só existe de verdade quando o
 * código que o implementa também existe, mas o nome já é reservado aqui desde a ADR 0017.
 */
import { z } from 'zod';

export const CORE_WORKSPACE_MODULE = 'core' as const;

export const OPTIONAL_WORKSPACE_MODULES = [
  'agile',
  'process',
  'schedule',
  'resources',
  'portfolio',
  'contracts',
  'ai',
] as const;
export type OptionalWorkspaceModule = (typeof OPTIONAL_WORKSPACE_MODULES)[number];

export const ALL_WORKSPACE_MODULES = [CORE_WORKSPACE_MODULE, ...OPTIONAL_WORKSPACE_MODULES] as const;
export type WorkspaceModule = (typeof ALL_WORKSPACE_MODULES)[number];

export function isWorkspaceModule(value: string): value is WorkspaceModule {
  return (ALL_WORKSPACE_MODULES as readonly string[]).includes(value);
}

export const WorkspaceModuleSchema = z.enum(ALL_WORKSPACE_MODULES);

/** `core` sempre presente; sem duplicatas. */
export const EnabledModulesSchema = z
  .array(WorkspaceModuleSchema)
  .min(1)
  .max(ALL_WORKSPACE_MODULES.length)
  .refine((modules) => modules.includes(CORE_WORKSPACE_MODULE), {
    message: "O módulo 'core' deve estar sempre presente.",
  })
  .refine((modules) => new Set(modules).size === modules.length, {
    message: 'Módulos duplicados.',
  });

/** Verifica se um módulo está ativo num workspace — mesma checagem em toda a API e no frontend. */
export function hasModule(enabledModules: readonly string[], module: OptionalWorkspaceModule): boolean {
  return enabledModules.includes(module);
}
