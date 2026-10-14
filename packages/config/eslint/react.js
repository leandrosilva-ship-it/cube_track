import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { createConfig } from './base.js';

/**
 * ESLint para pacotes React (packages/ui, apps/web): regras base + hooks + acessibilidade (jsx-a11y).
 *
 * @param {string} tsconfigRootDir diretório do pacote que contém o tsconfig.json
 */
export function createReactConfig(tsconfigRootDir) {
  return [
    ...createConfig(tsconfigRootDir),
    { ignores: ['storybook-static/**', '.next/**', 'next-env.d.ts', 'public/**'] },
    {
      files: ['**/*.{ts,tsx}'],
      plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
      languageOptions: { globals: { ...globals.browser } },
      rules: {
        ...reactHooks.configs.recommended.rules,
        ...jsxA11y.flatConfigs.strict.rules,
        // Handlers de evento async são comuns em React (onClick={async () => …}).
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
      },
    },
  ];
}
