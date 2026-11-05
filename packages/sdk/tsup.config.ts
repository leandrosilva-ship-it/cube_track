import { defineConfig } from 'tsup';

/**
 * Empacota o SDK como biblioteca ESM com declarações de tipo — ao contrário de `apps/api`/`apps/worker`
 * (executáveis Node, dependências internas embutidas), este pacote é feito para ser usado FORA do
 * monorepo, então sai com `.d.ts` e sem dependências a resolver (não tem nenhuma além de tipos).
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  sourcemap: true,
  clean: true,
  dts: true,
});
