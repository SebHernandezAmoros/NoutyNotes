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
    // Codecs de formato: texto en memoria, sin UI, plataforma ni filesystem (ADR 0007).
    files: ['packages/storage/**/*.ts'],
    ignores: ['packages/storage/**/*.test.ts', 'packages/storage/**/__fixtures__/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['react', 'react/*', 'react-native', 'react-native-*', 'expo', 'expo-*', 'node:*', 'fs', 'path', '@noutynotes/ui', '**/ui/**', '**/apps/**', '**/domain/src/**'],
          message: 'Storage solo depende del API público de @noutynotes/domain y application, yaml, zod y fflate (ZIP); los adaptadores de plataforma llegan en fases posteriores.',
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
