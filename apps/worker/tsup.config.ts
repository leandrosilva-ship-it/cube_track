import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/instrumentation.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@cube-track\//],
  external: [/^(?!@cube-track\/)[^./]/],
});
