import { assetsOf, inspectImage } from '@noutynotes/application';
import type { WorkspaceStorage } from '@noutynotes/application';
import type { AssetRef, CardId, Workspace } from '@noutynotes/domain';
import { useEffect, useState } from 'react';

import { dataUri } from './dataUri';

/**
 * Vista previa de las tarjetas de imagen importadas (ADR 0015): lee cada asset por el puerto y lo
 * convierte en `data:` URI, sin red. Una tarjeta de ejemplo (sin asset) no tiene vista previa.
 */
export function useImagePreviews(storage: WorkspaceStorage, workspace: Workspace | null): ReadonlyMap<CardId, string> {
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(new Map());
  const wanted = workspace
    ? workspace.cards.flatMap((card) => {
      const [ref] = card.assetRefs ?? [];
      return ref && /\.(png|jpe?g|gif|webp)$/i.test(ref) ? [{ cardId: card.id, ref }] : [];
    })
    : [];
  const key = wanted.map(({ ref }) => ref).join('|');
  const workspaceId = workspace?.id;

  useEffect(() => {
    const assets = assetsOf(storage);
    if (!assets || !workspaceId || key === '') return;
    let active = true;
    void (async () => {
      const next = new Map<string, string>();
      for (const ref of key.split('|') as AssetRef[]) {
        const read = await assets.readAsset(workspaceId, ref);
        if (!read.ok) continue;
        const kind = inspectImage(read.value);
        if (kind.ok) next.set(ref, dataUri(kind.value.mimeType, read.value));
      }
      if (active) setPreviews(next);
    })();
    return () => { active = false; };
  }, [storage, workspaceId, key]);

  return new Map(wanted.flatMap(({ cardId, ref }) => {
    const uri = previews.get(ref);
    return uri ? [[cardId, uri] as const] : [];
  }));
}
