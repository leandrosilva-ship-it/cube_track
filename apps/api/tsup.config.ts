import { defineConfig } from 'tsup';

/**
 * Empacota a API com SWC (metadados de decorators para a injeção de dependências do Nest) e
 * inclui os pacotes internos do monorepo, que são consumidos como código-fonte (ADR 0025).
 */
export default defineConfig({
  entry: ['src/main.ts', 'src/main.realtime.ts', 'src/instrumentation.ts', 'src/openapi-export.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  splitting: true,
  noExternal: [/^@cube-track\//],
  // Dependências de terceiros (inclusive as dos pacotes internos) ficam externas, resolvidas em node_modules.
  external: [/^(?!@cube-track\/)[^./]/],
});
