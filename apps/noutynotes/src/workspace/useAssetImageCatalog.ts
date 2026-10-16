import { assetKind, assetsOf, buildAssetCatalog, inspectImage } from '@noutynotes/application';
import type { WorkspaceStorage } from '@noutynotes/application';
import type { AssetRef, Workspace } from '@noutynotes/domain';
import { useEffect, useState } from 'react';

import { dataUri } from './dataUri';

/** Formatos que la inserción enriquecida sabe representar (ASSET-05): el catálogo de Assets puede
 * clasificar SVG/AVIF/BMP como imagen, pero no son un formato que `inspectImage` admita. */
const INSERTABLE_IMAGE_REF = /\.(png|jpe?g|gif|webp)$/i;

export interface AssetImageCatalogEntry {
  readonly ref: string;
  readonly name: string;
  /** Referenciado por el catálogo, pero ya no está en el almacenamiento. */
  readonly missing: boolean;
  /** Compatible con la inserción enriquecida real (PNG/JPEG/GIF/WebP); se muestra igual, pero no se
   * puede elegir — no ocultar Assets que el catálogo general sí clasifica como imagen. */
  readonly compatible: boolean;
  readonly previewUri?: string;
}

/**
 * Catálogo de imágenes de Assets con miniatura, para el selector «Insertar desde Assets» (ASSET-04).
 * A diferencia de `useImagePreviews` (que solo resuelve imágenes YA usadas por alguna nota), incluye
 * todas las imágenes del proyecto — el propósito de este selector es justamente elegir una que todavía
 * no está en ninguna parte. Solo lee bytes mientras `workspace` no es null (el llamador lo pasa como
 * null cuando el selector está cerrado, para no leer Assets sin necesidad).
 */
export function useAssetImageCatalog(storage: WorkspaceStorage, workspace: Workspace | null): { readonly entries: readonly AssetImageCatalogEntry[]; readonly loading: boolean } {
  const [listed, setListed] = useState<readonly string[] | null>(null);
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, string>>(new Map());
  const workspaceId = workspace?.id;

  useEffect(() => {
    const assets = assetsOf(storage);
    // Sin `workspace` (selector cerrado) no hay nada que leer; el estado anterior queda sin usar —
    // `workspace` ya null hace que el resultado expuesto más abajo sea `{ entries: [], loading: false }`
    // de todas formas, y la próxima apertura vuelve a ejecutar este efecto con datos frescos. `loading`
    // se deriva de `listed === null` (más abajo), nunca se fija aquí (reglas `react-hooks` del
    // proyecto prohíben `setState` síncrono dentro del cuerpo del efecto).
    if (!assets || !workspaceId) return undefined;
    let active = true;
    void (async () => {
      const result = await assets.listAssets(workspaceId);
      if (!active) return;
      if (!result.ok) { setListed([]); return; }
      setListed(result.value);
      const next = new Map<string, string>();
      for (const ref of result.value) {
        if (assetKind(ref) !== 'image' || !INSERTABLE_IMAGE_REF.test(ref)) continue;
        const read = await assets.readAsset(workspaceId, ref as AssetRef);
        if (!active) return;
        if (!read.ok) continue;
        const kind = inspectImage(read.value);
        if (kind.ok) next.set(ref, dataUri(kind.value.mimeType, read.value));
      }
      if (active) setThumbs(next);
    })();
    return () => { active = false; };
  }, [storage, workspaceId]);

  if (!workspace || listed === null) return { entries: [], loading: workspace !== null };
  const entries = buildAssetCatalog(workspace, listed)
    .filter((entry) => entry.kind === 'image')
    .map((entry): AssetImageCatalogEntry => {
      const previewUri = thumbs.get(entry.ref);
      return {
        ref: entry.ref, name: entry.name, missing: entry.missing, compatible: INSERTABLE_IMAGE_REF.test(entry.ref),
        ...(previewUri !== undefined ? { previewUri } : {}),
      };
    });
  return { entries, loading: false };
}
