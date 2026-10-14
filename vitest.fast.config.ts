import { defineConfig } from 'vitest/config';

/**
 * Contratos críticos para cada push. La regresión completa sigue en vitest.config.ts.
 * La lista es explícita para que FAST no crezca accidentalmente al añadir pruebas nuevas.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/domain/src/assets/asset-ref.test.ts',
      'packages/domain/src/cards/card.test.ts',
      'packages/domain/src/rich-text/rich-text.test.ts',
      'packages/application/src/draft-store.test.ts',
      'packages/application/src/note-blocks.test.ts',
      'packages/application/src/reactive-workspace.test.ts',
      'packages/storage/src/folder-storage.test.ts',
      'packages/storage/src/rich-text-html-codec.test.ts',
      'packages/storage/src/workspace-archive.test.ts',
      'packages/storage/src/workspace-codec.test.ts',
      'apps/noutynotes/src/session/draftPersistenceCore.test.ts',
      'apps/noutynotes/src/workspace/richTextLexical.test.ts',
      'tests/integration/editorial-drafts.test.ts',
      'tests/integration/image-assets.test.ts',
      'tests/integration/workspace-editing.test.ts',
      'tests/integration/workspace-files.test.ts',
    ],
  },
});
