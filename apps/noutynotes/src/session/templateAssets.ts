import type { AssetRef } from '@noutynotes/domain';
import type { ImageSourcePropType } from 'react-native';

import gddSvg from '../../assets/templates/assets/gdd.svg';
import researchSvg from '../../assets/templates/assets/research.svg';
import storyboardSvg from '../../assets/templates/assets/storyboard.svg';

/**
 * Bytes de un asset de una plantilla incorporada (fase 11a, ADR 0033): `instantiateTemplate` (dominio)
 * solo aporta la ruta declarada, nunca los bytes; eso es responsabilidad de la interfaz. En web, Metro
 * resuelve el recurso importado a una URL estática servida por el propio bundle, que se lee con `fetch`.
 */
const SOURCES: Readonly<Record<string, ImageSourcePropType>> = {
  'assets/gdd.svg': gddSvg,
  'assets/research.svg': researchSvg,
  'assets/storyboard.svg': storyboardSvg,
};

function sourceUri(source: ImageSourcePropType): string {
  if (typeof source === 'string') return source;
  if (Array.isArray(source)) return sourceUri(source[0] as ImageSourcePropType);
  if (typeof source === 'object' && source !== null && 'uri' in source && typeof source.uri === 'string') return source.uri;
  throw new Error('Recurso de plantilla sin URL en web.');
}

export async function readTemplateAsset(ref: AssetRef): Promise<Uint8Array> {
  const source = SOURCES[ref];
  if (source === undefined) throw new Error(`Asset de plantilla desconocido: ${ref}`);
  const response = await fetch(sourceUri(source));
  if (!response.ok) throw new Error(`No se pudo leer ${ref} del paquete de la app.`);
  return new Uint8Array(await response.arrayBuffer());
}
