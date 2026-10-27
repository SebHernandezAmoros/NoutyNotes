import { expect, it, vi } from 'vitest';
import { block8Workspace, pdfRef, fontRef } from '../../../tests/fixtures/block8-content';
import { buildAssetCatalog } from './assets-catalog';
import { analyzeAssetReferences } from './asset-reference-analysis';
import { planAssetDetachment } from './asset-detachment-plan';
import { inspectNotePdf, prepareNotePdf } from './note-pdfs';
import type { WorkspaceAssets } from './workspace-assets';

it('reconoce PDF y fuente sin permitir planes destructivos ni doble conteo del carrier', () => {
  const workspace = block8Workspace();
  for (const ref of [pdfRef, fontRef]) {
    expect(buildAssetCatalog(workspace, [ref]).find((entry) => entry.ref === ref)?.unused).toBe(false);
    const analysis = analyzeAssetReferences({ workspace, ref, unverified: ['otras sesiones'] });
    expect(analysis.status).toBe('partial');
    expect(analysis.ownerCount).toBe(1);
    expect(analysis.occurrenceCount).toBe(1);
    const plan = planAssetDetachment({ snapshot: workspace, assetRef: ref, analysis });
    expect(plan.executionAllowed).toBe(false);
    expect(plan.status).toBe('unresolved');
  }
});
it('valida firma y límite portable sin truncar; recurso existente no copia ni elimina bytes', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\n%%EOF');
  expect(inspectNotePdf(bytes).ok).toBe(true);
  expect(inspectNotePdf(new Uint8Array(16 * 1024 * 1024 + 1)).ok).toBe(false);
  expect(inspectNotePdf(new TextEncoder().encode('<html>fake')).ok).toBe(false);
  const assets = { readAsset: vi.fn(async () => ({ ok: true, value: bytes })), writeAsset: vi.fn(), removeAsset: vi.fn() } as unknown as WorkspaceAssets;
  const workspace = block8Workspace();
  const result = await prepareNotePdf(assets, workspace.id, pdfRef, 'Manual');
  expect(result).toEqual({ ok: true, value: { type: 'pdf', assetRef: pdfRef, label: 'Manual' } });
  expect(assets.writeAsset).not.toHaveBeenCalled();
  expect(assets.removeAsset).not.toHaveBeenCalled();
});
