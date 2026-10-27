import { afterEach, expect, it, vi } from 'vitest';
import { printableDocument } from '@noutynotes/application';
import { block8Workspace } from '../../../../tests/fixtures/block8-content';
import { buildPrintHtml } from './printHtml';
import { loadPrintFonts } from './printFonts';
import type { WorkspaceAssets } from '@noutynotes/application';

afterEach(() => vi.unstubAllGlobals());

it('imprime los párrafos vecinos y descriptor PDF4 sin conversión Markdown con pérdida', () => {
  const source = block8Workspace();
  const entries = printableDocument(source, source.boards[0]!.id);
  const html = buildPrintHtml('B8', entries, new Map());
  expect(html).toContain('Antes del PDF');
  expect(html).toContain('Después del PDF');
  expect(html).toContain('Manual &lt;local&gt;');
  expect(html).not.toContain('<iframe');
});

it('una fuente con cabecera válida pero ilegible usa fallback sin impedir la salida del contenido', async () => {
  vi.stubGlobal('FontFace', class { async load() { throw new Error('Invalid font data'); } });
  const source = block8Workspace();
  const entries = printableDocument(source, source.boards[0]!.id);
  const assets = { readAsset: async () => ({ ok: true, value: new Uint8Array([0, 1, 0, 0, 1]) }) } as unknown as WorkspaceAssets;
  const fonts = await loadPrintFonts(assets, source.id, entries);
  expect(fonts.size).toBe(0);
  const html = buildPrintHtml('B8', entries, new Map(), { fonts });
  expect(html).toContain('Fuente no disponible');
  expect(html).toContain('Después del PDF');
});
