import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // packages/shared É o domínio (CLAUDE.md §4): regras de negócio puras (fórmulas, agendamento,
      // permissões, portfólio, contratos, capacity, billing, security etc.), sem Nest/Drizzle/I-O.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Barris só de re-export, sem lógica própria (cobertura deles não mede nada).
        'src/index.ts',
        'src/columns/index.ts',
        'src/formula/index.ts',
        // Contratos/tipos puros (schemas Zod de payload de fila, nomes de evento → consumidor,
        // interfaces de contexto de fórmula): wiring entre API/worker, sem decisão de negócio própria
        // para testar — equivalente a `generated/` para efeito desta métrica (ver CLAUDE.md §5).
        'src/jobs.ts',
        'src/events.ts',
        'src/formula/context.ts',
      ],
    },
  },
});
