import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Card, CardId } from '../../packages/domain/src/index';
import { serializeWorkspace } from '../../packages/storage/src/workspace-codec';
import { readWorkspaceArchive, writeWorkspaceArchive } from '../../packages/storage/src/workspace-archive';
import { removedCardsWorkspace } from '../fixtures/removed-cards';

function value<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly unknown[] }): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

test('U2-A fixture ZIP: retiradas seleccionables, Inspector sin visor, contraste y exportación intacta', async ({ page }, info) => {
  const source = removedCardsWorkspace();
  const missing: Card = { id: 'temporary' as CardId, typeId: source.cards[0]!.typeId, title: 'Imagen temporal', fields: {}, assetRefs: ['assets/images/missing.png' as NonNullable<Card['assetRefs']>[number]] };
  const fixture = { ...source, id: 'u2-a-fixture' as typeof source.id, metadata: { name: 'Laboratorio U2-A' }, cards: [...source.cards, missing],
    boards: source.boards.map((board, index) => index === 0 ? { ...board, cardIds: [...board.cardIds, missing.id] } : board),
    layouts: source.layouts.map((layout, index) => index === 0 ? { ...layout, placements: [
      { cardId: source.cards[0]!.id, rect: { x: 0, y: 0, w: 6, h: 5 }, display: 'expanded' as const },
      { cardId: source.cards[1]!.id, rect: { x: 7, y: 0, w: 6, h: 5 }, display: 'expanded' as const },
      { cardId: missing.id, rect: { x: 0, y: 6, w: 6, h: 5 }, display: 'expanded' as const },
    ] } : layout),
  };
  const zip = value(writeWorkspaceArchive(value(serializeWorkspace(fixture)), {}));
  writeFileSync('artifacts/u2-a-fixture.zip', zip);
  const popups: string[] = [];
  page.on('popup', (popup) => { popups.push(popup.url()); });
  await page.emulateMedia({ colorScheme: info.project.name === 'mobile' ? 'light' : 'dark' });
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importar un ZIP', exact: true }).click();
  await (await chooser).setFiles({ name: 'u2-a-fixture.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.getByRole('heading', { name: 'Laboratorio U2-A', exact: true })).toBeVisible();
  await expect(page.getByTestId('retired-card-idea-a')).toContainText('Recurso retirado', { timeout: 5000 });
  await expect(page.getByTestId('retired-card-idea-b')).toContainText('Recurso retirado');
  await expect(page.getByTestId('card-temporary')).not.toContainText('Recurso retirado');
  await expect(page.getByTestId('image-status-temporary')).toContainText('Imagen no disponible');
  for (const card of source.cards) {
    const element = page.getByTestId(`card-${card.id}`);
    await expect(element).toContainText(card.title!);
    await expect(element.locator('img')).toHaveCount(0);
    await element.focus();
    await page.keyboard.press('Space');
    await expect(element).toHaveAttribute('aria-pressed', 'true');
    await element.dblclick();
    const inspector = page.getByTestId('card-inspector');
    await expect(inspector).toContainText('Recurso retirado');
    await expect(page.getByTestId('asset-pdf-preview')).toHaveCount(0);
    await expect(page.getByTestId('inline-card-editor')).toHaveCount(0);
    await inspector.screenshot({ path: `artifacts/u2-a-inspector-${card.id}-${info.project.name}.png` });
    await page.getByRole('button', { name: 'Cerrar el editor de la tarjeta', exact: true }).click();
    await element.focus();
    if (await element.getAttribute('aria-pressed') !== 'true') await page.keyboard.press('Space');
    if (info.project.name === 'mobile') {
      const title = await element.getByText(card.title!, { exact: true }).boundingBox();
      const actions = await page.getByTestId(`card-actions-${card.id}`).boundingBox();
      expect(title).not.toBeNull();
      expect(actions).not.toBeNull();
      if (title && actions) {
        const overlap = title.x < actions.x + actions.width - 1 && title.x + title.width > actions.x + 1
          && title.y < actions.y + actions.height - 1 && title.y + title.height > actions.y + 1;
        expect(overlap, 'El título retirado no debe quedar bajo el menú de la tarjeta').toBe(false);
      }
    }
    await element.screenshot({ path: `artifacts/u2-a-${card.id}-${info.project.name}.png` });
  }
  expect(popups).toEqual([]);
  await page.getByRole('button', { name: 'Vista de lista', exact: true }).click();
  for (const card of source.cards) {
    const listed = page.getByTestId(`retired-list-${card.id}`);
    await expect(listed).toBeVisible();
    await expect(listed).toContainText(card.title!);
    await expect(listed).toContainText('Recurso retirado');
    await expect(page.getByTestId(`card-${card.id}`).locator('img')).toHaveCount(0);
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar este espacio como ZIP', exact: true }).click();
  const file = await (await download).path();
  if (!file) throw new Error('No se obtuvo el ZIP de la fixture');
  const reopened = value(readWorkspaceArchive(new Uint8Array(readFileSync(file))));
  expect(reopened.workspace.cards).toEqual(fixture.cards);
  expect(reopened.workspace.layouts).toEqual(fixture.layouts);
  expect(reopened.workspace.relations).toEqual(fixture.relations);
  expect(reopened.assets).toEqual({});
});
