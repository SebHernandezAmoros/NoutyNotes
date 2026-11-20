import { inspectImage } from '@noutynotes/application';
import type { WorkspaceAssets } from '@noutynotes/application';
import type { AssetRef, WorkspaceId } from '@noutynotes/domain';

import { imageResourceUri } from './imageResourceUri';

/**
 * Estado de disponibilidad de una imagen (OBS-N2-IMAGE-FIT-F2). Vista, no dominio ni durable: nunca se
 * persiste ni participa en el Workspace. `missing` agrupa las tres causas observables hoy con los
 * contratos existentes de almacenamiento, porque las tres reciben el mismo tratamiento visual — ver
 * `Docs/knowledge/OBS-N2-IMAGE-FIT-SPEC.md`, sección «F2-PRECHECK», apartados 3-5.
 */
export type ImageResourceState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly uri: string }
  | {
      readonly status: 'missing';
      /** `not-found`: `listAssets` no la incluye. `unreadable`: listada, pero `readAsset` falla
       * (io-failure: permiso denegado o error de lectura — el contrato no distingue entre ambos, así
       * que nunca se afirma «no existe» sin que `listAssets` lo haya confirmado primero).
       * `invalid-image`: los bytes se leyeron, pero `inspectImage` rechaza su formato. */
      readonly reason: 'not-found' | 'unreadable' | 'invalid-image';
    };

/** Resuelve una sola referencia contra un conjunto de rutas ya enumerado (una sola vez por lote). */
export async function resolveImageResource(
  assets: WorkspaceAssets, workspaceId: WorkspaceId, ref: AssetRef, known: ReadonlySet<string>,
): Promise<ImageResourceState> {
  // Nunca se afirma «no existe» sin que la enumeración fiable lo haya confirmado primero.
  if (!known.has(ref)) return { status: 'missing', reason: 'not-found' };
  const read = await assets.readAsset(workspaceId, ref);
  if (!read.ok) return { status: 'missing', reason: 'unreadable' };
  const kind = inspectImage(read.value);
  if (!kind.ok) return { status: 'missing', reason: 'invalid-image' };
  try {
    return { status: 'ready', uri: await imageResourceUri(kind.value.mimeType, read.value) };
  } catch {
    return { status: 'missing', reason: 'unreadable' };
  }
}

/**
 * Resuelve un lote de referencias con una sola llamada a `listAssets` para todas (no una por ref) y
 * las lecturas de bytes en paralelo. Si `listAssets` falla, ninguna referencia puede confirmarse como
 * existente: todas quedan `unreadable` (nunca `not-found`, que exige una enumeración exitosa).
 */
export async function resolveImageResources(
  assets: WorkspaceAssets, workspaceId: WorkspaceId, refs: readonly AssetRef[],
  previous: ReadonlyMap<string, ImageResourceState> = new Map(),
): Promise<ReadonlyMap<AssetRef, ImageResourceState>> {
  const listed = await assets.listAssets(workspaceId);
  if (!listed.ok) {
    return new Map(refs.map((ref) => [ref, { status: 'missing', reason: 'unreadable' } as const]));
  }
  const known = new Set(listed.value);
  const resolved = await Promise.all(refs.map(async (ref) => {
    const cached = previous.get(ref);
    // Asset writes never overwrite an existing path. Recheck membership, retry failed previews,
    // and reuse only successfully decoded immutable resources from this storage/workspace.
    const resource = known.has(ref) && cached?.status === 'ready'
      ? cached : await resolveImageResource(assets, workspaceId, ref, known);
    return [ref, resource] as const;
  }));
  return new Map(resolved);
}
