import { spawnSync } from 'node:child_process';

const areas = {
  editor: {
    units: [
      'packages/domain/src/rich-text/rich-text.test.ts',
      'packages/application/src/note-blocks.test.ts',
      'packages/storage/src/rich-text-html-codec.test.ts',
      'apps/noutynotes/src/workspace/richTextLexical.test.ts',
    ],
    grep: 'P06:|P07:|P08:|P09:|P18-E3|UX7 Hito 8|alineación vertical',
    desktopOnly: true,
  },
  canvas: {
    units: [
      'packages/domain/src/layouts/grid.test.ts',
      'packages/domain/src/layouts/operations.test.ts',
      'apps/noutynotes/src/workspace/canvas/geometry.test.ts',
      'apps/noutynotes/src/workspace/canvas/viewport.test.ts',
      'apps/noutynotes/src/workspace/canvas/cardChrome.test.ts',
    ],
    grep: 'minimizar|Contraída|arrastrar|lienzo de mundo|zoom|selección múltiple|marcos:',
    desktopOnly: true,
  },
  persistence: {
    units: [
      'packages/application/src/draft-store.test.ts',
      'packages/application/src/reactive-workspace.test.ts',
      'packages/storage/src/folder-storage.test.ts',
      'packages/storage/src/memory-storage.test.ts',
      'packages/storage/src/workspace-codec.test.ts',
      'tests/integration/editorial-drafts.test.ts',
      'tests/integration/workspace-files.test.ts',
    ],
    grep: 'carpeta web:|UX7-SAVE:|E3-A:|cambio externo|texto pendiente',
    desktopOnly: true,
  },
  assets: {
    units: [
      'packages/domain/src/assets/asset-ref.test.ts',
      'packages/application/src/assets-catalog.test.ts',
      'tests/integration/assets-library.test.ts',
      'tests/integration/image-assets.test.ts',
      'tests/integration/note-images.test.ts',
    ],
    grep: 'imagen|Assets:|biblioteca de assets',
    desktopOnly: true,
  },
  'import-export': {
    units: [
      'packages/application/src/archive-export.test.ts',
      'packages/storage/src/archive-storage.test.ts',
      'packages/storage/src/workspace-archive.test.ts',
      'tests/integration/workspace-archive.test.ts',
    ],
    grep: 'ZIP:|importar ZIP|exportar|respaldo ZIP|importación inválida',
    desktopOnly: true,
  },
  navigation: {
    units: [
      'apps/noutynotes/src/home/actions.test.ts',
      'tests/integration/workspace-boards.test.ts',
      'tests/integration/links-global-search.test.ts',
    ],
    grep: 'inicio responsive|tableros y espacios|búsqueda|Proyectos',
    desktopOnly: true,
  },
  responsive: {
    units: [
      'apps/noutynotes/src/workspace/canvas/geometry.test.ts',
      'apps/noutynotes/src/workspace/canvas/viewport.test.ts',
    ],
    grep: 'responsive|móvil, tablet|límite responsive|accesibilidad',
  },
  'web-mobile': {
    units: [],
    config: 'playwright.fast.config.ts',
  },
};

const area = process.argv[2];
if (!area || !(area in areas)) {
  console.error(`Área requerida. Opciones: ${Object.keys(areas).join(', ')}`);
  process.exit(2);
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const run = (args) => {
  const result = spawnSync(pnpm, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const selected = areas[area];
if (selected.units.length > 0) run(['exec', 'vitest', 'run', ...selected.units]);

const playwrightArgs = ['exec', 'playwright', 'test'];
if (selected.config) playwrightArgs.push('--config', selected.config);
if (selected.grep) playwrightArgs.push('--grep', selected.grep);
if (selected.desktopOnly) playwrightArgs.push('--project=desktop');
run(playwrightArgs);
