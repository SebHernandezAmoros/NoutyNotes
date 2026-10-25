import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { readWorkspaceArchive, writeWorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { removedImageWorkspace } from '../fixtures/removed-image-blocks';
import { openFullCardEditor } from './support';
import { serializeRichTextHtml } from '../../packages/storage/src/rich-text-html-codec';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

test('U2-B: marcador inerte, vecinos editables, Visual/HTML y ZIP reabierto', async ({ page }, info) => {
  const source = removedImageWorkspace();
  const fixture = { ...source, id: 'u2-b-fixture' as typeof source.id, metadata: { name: 'Laboratorio U2-B' },
    cards: source.cards.map((card, index) => index === 0 ? card : { ...card, title: 'Control no disponible', contentDocument: { schemaVersion: 2 as const, blocks: [
      { type: 'image' as const, assetRef: 'assets/images/missing.png' as NonNullable<typeof card.assetRefs>[number], alt: 'Control', accessibilityIntent: 'informative' as const, captionPolicy: 'explicit' as const },
    ] } }),
    layouts: source.layouts.map((layout) => ({ ...layout, placements: layout.placements.map((placement, index) => ({ ...placement,
      rect: { x: index * 9, y: 0, w: 8, h: 7 }, display: 'expanded' as const })) })),
  };
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(fixture)), {}));
  writeFileSync('artifacts/u2-b-fixture.zip', zip);
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'light' : 'dark' });
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const popups: string[] = [];
  page.on('popup', (popup) => popups.push(popup.url()));
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles({ name: 'u2-b.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  const card = page.getByTestId('card-idea-a');
  await expect(card).toContainText('Texto anterior conservado');
  await expect(card).toContainText('Imagen retirada');
  await expect(card).toContainText('Texto posterior conservado');
  await expect(card.locator('img')).toHaveCount(0);
  await expect(page.getByTestId('card-idea-b')).toContainText('Imagen no disponible');
  await expect(page.getByTestId('card-idea-b')).not.toContainText('Imagen retirada');
  await card.screenshot({ path: `artifacts/u2-b-canvas-${info.project.name}.png` });
  if (info.project.name === 'desktop') await card.dblclick();
  else await openFullCardEditor(page, card);
  let editor = page.getByLabel('Contenido visual', { exact: true });
  await expect(editor.getByTestId('editor-retired-image')).toBeVisible();
  await expect(editor.locator('img')).toHaveCount(0);
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' editado');
  await expect(editor.locator('p').first()).toHaveText('Texto anterior conservado editado');
  await page.keyboard.press('Control+z');
  await expect(editor.locator('p').first()).toHaveText('Texto anterior conservado');
  await page.keyboard.press('Control+Shift+z');
  await expect(editor.locator('p').first()).toHaveText('Texto anterior conservado editado');
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' editado');
  await expect(editor.locator('p').last()).toHaveText('Texto posterior conservado editado');
  await editor.screenshot({ path: `artifacts/u2-b-editor-${info.project.name}.png` });
  if (info.project.name === 'desktop') await openFullCardEditor(page, card);
  await page.getByRole('button', { name: 'Editar el código HTML del cuerpo', exact: true }).click();
  await expect(page.getByTestId('html-source-input')).toHaveValue(/data-nouty-resource-state="retired"/);
  await page.getByRole('button', { name: 'Validar y aplicar el código HTML', exact: true }).click();
  await page.getByRole('button', { name: 'Editar el cuerpo visualmente', exact: true }).click();
  editor = page.getByLabel('Contenido visual', { exact: true });
  await expect(editor.getByTestId('editor-retired-image')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar texto', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const file = await (await download).path();
  if (!file) throw new Error('No llegó el ZIP exportado.');
  const savedBytes = new Uint8Array(readFileSync(file));
  const reopened = value(readWorkspaceArchive(savedBytes));
  const doc = reopened.workspace.cards.find((item) => item.id === 'idea-a')?.contentDocument;
  expect(doc?.schemaVersion).toBe(3);
  expect(doc?.blocks[1]).toEqual(source.cards[0]?.contentDocument?.blocks[1]);
  expect(doc?.blocks[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Texto anterior conservado editado' }] });
  expect(doc?.blocks[2]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Texto posterior conservado editado' }] });
  expect(reopened.workspace.layouts).toEqual(fixture.layouts);
  expect(reopened.workspace.relations).toEqual(fixture.relations);
  expect(reopened.assets).toEqual({});
  await page.goto('./');
  const reopenChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await reopenChooser).setFiles({ name: 'u2-b-reopened.zip', mimeType: 'application/zip', buffer: Buffer.from(savedBytes) });
  await expect(page.getByTestId('card-idea-a')).toContainText('Imagen retirada');
  await expect(page.getByTestId('card-idea-a')).toContainText('Texto posterior conservado editado');
  await page.getByTestId('card-idea-a').screenshot({ path: `artifacts/u2-b-reopened-${info.project.name}.png` });
  await page.getByRole('button', { name: 'Vista de lista', exact: true }).click();
  await expect(page.getByTestId('card-idea-a')).toContainText('Imagen retirada');
  await expect(page.getByTestId('card-idea-a')).toContainText('Texto posterior conservado editado');
  await expect(page.getByTestId('card-idea-a').locator('img')).toHaveCount(0);
  // A long inert caption must participate in overflow; the following paragraph stays reachable.
  await page.getByRole('button', { name: 'Vista de lista', exact: true }).click();
  await openFullCardEditor(page, page.getByTestId('card-idea-a'));
  await page.getByRole('button', { name: 'Editar el código HTML del cuerpo', exact: true }).click();
  const marker = source.cards[0]!.contentDocument!.blocks[1]!;
  if (marker.type !== 'retired-image') throw new Error('Fixture de marcador inválida.');
  const longHtml = value(serializeRichTextHtml({ schemaVersion: 3, blocks: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Antes del marcador largo' }] },
    { ...marker, caption: Array.from({ length: 50 }, (_, index) => [
      { type: 'text' as const, text: `Detalle conservado ${index}` }, { type: 'hard-break' as const },
    ]).flat() },
    { type: 'paragraph', content: [{ type: 'text', text: 'Final del marcador largo' }] },
  ] }));
  await page.getByTestId('html-source-input').fill(longHtml);
  await page.getByRole('button', { name: 'Validar y aplicar el código HTML', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar texto', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
  const reader = page.getByTestId('card-reader-idea-a');
  await expect(reader).toBeVisible();
  await reader.focus();
  await page.keyboard.press('End');
  const last = reader.getByText('Final del marcador largo', { exact: true });
  await expect(last).toBeVisible();
  const readerBox = await reader.boundingBox();
  const lastBox = await last.boundingBox();
  expect(readerBox).not.toBeNull();
  expect(lastBox).not.toBeNull();
  if (readerBox && lastBox) expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(readerBox.y + readerBox.height + 1);
  await reader.screenshot({ path: `artifacts/u2-b-long-reader-${info.project.name}.png` });
  expect(errors).toEqual([]);
  expect(popups).toEqual([]);
});
