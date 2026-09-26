import { File } from 'expo-file-system';

import { IMAGE_MIME_TYPES } from './imageTypes';
import type { PickedFile } from './imageTypes';

export type { PickedFile } from './imageTypes';

export function supportsImageImport(): boolean {
  return true;
}

/**
 * Selector de archivos del sistema (`File.pickFileAsync` de expo-file-system 57, ADR 0015): sin
 * dependencias nuevas. Cancelar devuelve `null`; el tipo real se valida después por su firma.
 */
export async function pickImageFile(): Promise<PickedFile | null> {
  const picked = await File.pickFileAsync({ mimeTypes: [...IMAGE_MIME_TYPES] });
  if (picked.canceled) return null;
  const file = picked.result;
  return { bytes: await file.bytes(), name: file.name };
}
