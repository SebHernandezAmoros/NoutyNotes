const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  {
    ignores: [
      '**/node_modules/**', '**/.expo/**', '**/dist/**', '**/coverage/**',
      'artifacts/**', 'Docs/**', 'apps/noutynotes/android/**',
    ],
  },
  expo,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/application/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['react', 'react/*', 'react-native', 'react-native-*', 'expo', 'expo-*', 'node:*', '@noutynotes/ui', '@noutynotes/storage', '**/storage/**', '**/ui/**', '**/apps/**'],
          message: 'El núcleo depende de reglas y puertos, no de UI o infraestructura.',
        }],
      }],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'fetch', 'indexedDB'],
    },
  },
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: "ImportDeclaration[source.value=/application/]",
        message: 'El dominio no depende de los casos de uso.',
      }],
    },
  },
]);
