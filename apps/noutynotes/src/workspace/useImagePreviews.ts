import { assetsOf, noteImageRefs, richTextImageRefs } from '@noutynotes/application';
import type { WorkspaceStorage } from '@noutynotes/application';
import type { AssetRef, CardId, Workspace } from '@noutynotes/domain';
import { useEffect, useState } from 'react';

import { resolveImageResources } from './imageResources';
import type { ImageResourceState } from './imageResources';

export interface ImagePreviews {
  /** Tarjetas de imagen: estado de su primera imagen (ADR 0015, OBS-N2-IMAGE-FIT-F2). */
  readonly cardResources: ReadonlyMap<CardId, ImageResourceState>;
  /** Imágenes dentro de notas, por ruta (ADR 0021, OBS-N2-IMAGE-FIT-F2). */
  readonly refResources: ReadonlyMap<string, ImageResourceState>;
  /**
   * Proyección de solo la URI cuando el estado es `ready` (compatibilidad): Impresión e Inspector,
   * fuera del alcance de F2, siguen leyendo exactamente lo mismo que antes — derivado de
   * `refResources`, no es una segunda fuente de verdad independiente.
   */
  readonly refs: ReadonlyMap<string, string>;
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

const readyUri = (resource: ImageResourceState | undefined): string | undefined => resource?.status === 'ready' ? resource.uri : undefined;

/**
 * Estados de disponibilidad sin red: `listAssets`+`readAsset`+`inspectImage` por el puerto, una sola
 * enumeración por lote (OBS-N2-IMAGE-FIT-F2-PRECHECK). Incluye la imagen de las tarjetas de imagen y
 * las imágenes intercaladas en las notas. Una tarjeta de ejemplo (sin asset) no tiene estado propio.
 */
export function useImagePreviews(storage: WorkspaceStorage, workspace: Workspace | null): ImagePreviews {
  // Solo guarda resultados ya resueltos (`ready`/`missing`); «loading» nunca se escribe en el estado,
  // se deriva en cada render para los refs que todavía no tienen resultado (ver `refResources`).
  const [resolved, setResolved] = useState<ReadonlyMap<string, ImageResourceState>>(new Map());
  const types = new Map((workspace?.cardTypes ?? []).map((type) => [type.id, type.base]));
  const cardRefs = (workspace?.cards ?? []).flatMap((card) => {
    const [ref] = card.assetRefs ?? [];
    return types.get(card.typeId) === 'image' && ref && IMAGE.test(ref) ? [{ cardId: card.id, ref }] : [];
  });
  const noteRefs = (workspace?.cards ?? []).flatMap((card) => (types.get(card.typeId) === 'image'
    ? []
    : [...noteImageRefs(card.content ?? ''), ...richTextImageRefs(card.contentDocument)]));
  const refs = [...new Set([...cardRefs.map(({ ref }) => ref), ...noteRefs])].filter((ref) => IMAGE.test(ref)).sort();
  const key = refs.join('|');
  const workspaceId = workspace?.id;

  useEffect(() => {
    const assets = assetsOf(storage);
    if (!assets || !workspaceId || key === '') return undefined;
    let active = true;
    void resolveImageResources(assets, workspaceId, key.split('|') as AssetRef[]).then((next) => {
      if (active) setResolved(next);
    });
    return () => { active = false; };
  }, [storage, workspaceId, key]);

  // Un ref ya resuelto en un lote anterior conserva su resultado sin parpadear a «cargando»; uno
  // genuinamente nuevo de este lote, o cualquiera si no hay workspace/assets, se deriva como `loading`.
  const refResources = new Map(refs.map((ref) => [ref, resolved.get(ref) ?? { status: 'loading' as const }]));
  const cardResources = new Map(cardRefs.flatMap(({ cardId, ref }) => {
    const resource = refResources.get(ref);
    return resource ? [[cardId, resource] as const] : [];
  }));
  const readyRefs = new Map([...refResources.entries()].flatMap(([ref, resource]) => {
    const uri = readyUri(resource);
    return uri ? [[ref, uri] as const] : [];
  }));

  return { cardResources, refResources, refs: readyRefs };
}
