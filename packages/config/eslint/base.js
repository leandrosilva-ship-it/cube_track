import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Configuração ESLint compartilhada (flat config) para pacotes TypeScript do CUBE TRACK.
 * Uso: `export default createConfig(import.meta.dirname);`
 *
 * @param {string} tsconfigRootDir diretório do pacote que contém o tsconfig.json
 */
export function createConfig(tsconfigRootDir) {
  return tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'migrations/**', '*.config.*'] },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': [
          'error',
          { allowNumber: true, allowBoolean: true },
        ],
        'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
        // Módulos NestJS são classes vazias decoradas.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
        eqeqeq: ['error', 'always'],
      },
    },
    prettier,
  );
}
