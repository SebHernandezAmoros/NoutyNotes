import type { AssetRef } from '@noutynotes/domain';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import gddSvg from '../../assets/templates/assets/gdd.svg';
import researchSvg from '../../assets/templates/assets/research.svg';
import storyboardSvg from '../../assets/templates/assets/storyboard.svg';

/**
 * Variante Android (fase 11a, ADR 0033): el recurso importado es un ID de módulo de Metro, no una URL.
 * `expo-asset` (nueva dependencia, mínima y del propio ecosistema Expo) lo resuelve a un archivo local
 * del dispositivo; sus bytes se leen con `expo-file-system` (`File`, ya usada en el resto de la app).
 */
const MODULES: Readonly<Record<string, number>> = {
  'assets/gdd.svg': gddSvg as unknown as number,
  'assets/research.svg': researchSvg as unknown as number,
  'assets/storyboard.svg': storyboardSvg as unknown as number,
};

export async function readTemplateAsset(ref: AssetRef): Promise<Uint8Array> {
  const moduleId = MODULES[ref];
  if (moduleId === undefined) throw new Error(`Asset de plantilla desconocido: ${ref}`);
  const asset = await Asset.fromModule(moduleId).downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return new File(uri).bytes();
}
