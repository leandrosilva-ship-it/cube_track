import { createRequire } from 'node:module';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
          useDefineForClassFields: false,
        },
        target: 'es2023',
      },
    }),
  ],
  resolve: {
    // O Nest carrega a build CommonJS do graphql; usar a mesma evita o "dual package hazard"
    // (classes duplicadas de GraphQLScalarType em ESM/CJS).
    alias: { graphql: require.resolve('graphql') },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Cobertura só do domínio (CLAUDE.md §5 "cobertura ≥80% no domínio"): regras de negócio
      // puras, sem Nest/Drizzle/I-O. application/infrastructure/presentation ficam de fora —
      // controllers e repositórios são wiring, medidos pelos *.e2e.test.ts de integração, não aqui.
      include: ['src/modules/*/domain/**/*.ts'],
      exclude: ['src/modules/*/domain/**/*.test.ts'],
    },
  },
});
