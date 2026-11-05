import { createConfig } from '@cube-track/config/eslint';

export default [
  // `scripts/generate.mjs` roda fora do `tsconfig.json` do pacote (script Node simples, sem tipos) —
  // mantém o lint com `projectService` restrito aos fontes TypeScript de `src/`.
  { ignores: ['scripts/**'] },
  ...createConfig(import.meta.dirname),
];
