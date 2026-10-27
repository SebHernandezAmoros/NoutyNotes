import { inspectFont } from '@noutynotes/application';
import type { PrintEntry, WorkspaceAssets } from '@noutynotes/application';
import type { WorkspaceId } from '@noutynotes/domain';
import { dataUri } from './dataUri';

/** Only validated local bytes; no external CSS, user-defined family or network. */
export async function loadPrintFonts(assets: WorkspaceAssets | null, workspaceId: WorkspaceId, entries: readonly PrintEntry[]): Promise<ReadonlyMap<string, string>> {
  const fonts = new Map<string, string>();
  if (!assets) return fonts;
  const refs = [...new Set(entries.flatMap((entry) => entry.noteFont?.kind === 'asset' ? [entry.noteFont.assetRef] : []))];
  await Promise.all(refs.map(async (ref) => {
    const read = await assets.readAsset(workspaceId, ref);
    if (!read.ok) return;
    const kind = inspectFont(read.value);
    if (!kind.ok || typeof FontFace === 'undefined') return;
    try {
      // Signature alone cannot prove the font is decodable. Do not register this probe.
      await new FontFace('nouty-print-probe', read.value.slice().buffer).load();
      fonts.set(ref, dataUri(`font/${kind.value.extension}`, read.value));
    } catch { /* The output renderer announces its System fallback. */ }
  }));
  return fonts;
}
