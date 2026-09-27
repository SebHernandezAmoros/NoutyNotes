import { assetsOf, inspectImage, noteImageRefs } from '@noutynotes/application';
import type { WorkspaceStorage } from '@noutynotes/application';
import type { AssetRef, CardId, Workspace } from '@noutynotes/domain';
import { useEffect, useState } from 'react';

import { dataUri } from './dataUri';

export interface ImagePreviews {
  /** Tarjetas de imagen: su primera imagen (ADR 0015). */
  readonly cards: ReadonlyMap<CardId, string>;
  /** Imágenes dentro de notas, por ruta (ADR 0021). */
  readonly refs: ReadonlyMap<string, string>;
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Vistas previas sin red: lee cada asset por el puerto y lo convierte en `data:` URI. Incluye la imagen
 * de las tarjetas de imagen y las imágenes intercaladas en las notas. Una tarjeta de ejemplo (sin asset)
 * no tiene vista previa.
 */
export function useImagePreviews(storage: WorkspaceStorage, workspace: Workspace | null): ImagePreviews {
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(new Map());
  const types = new Map((workspace?.cardTypes ?? []).map((type) => [type.id, type.base]));
  const cardRefs = (workspace?.cards ?? []).flatMap((card) => {
    const [ref] = card.assetRefs ?? [];
    return types.get(card.typeId) === 'image' && ref && IMAGE.test(ref) ? [{ cardId: card.id, ref }] : [];
  });
  const noteRefs = (workspace?.cards ?? []).flatMap((card) => (types.get(card.typeId) === 'image' ? [] : noteImageRefs(card.content ?? '')));
  const key = [...new Set([...cardRefs.map(({ ref }) => ref), ...noteRefs])].filter((ref) => IMAGE.test(ref)).sort().join('|');
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

  return {
    cards: new Map(cardRefs.flatMap(({ cardId, ref }) => {
      const uri = previews.get(ref);
      return uri ? [[cardId, uri] as const] : [];
    })),
    refs: previews,
  };
}
