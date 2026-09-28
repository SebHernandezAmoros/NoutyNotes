import { File } from 'expo-file-system';

import { LIBRARY_FILE_MIME_TYPES } from './fileTypes';
import type { PickedFile } from './imageTypes';

export type { PickedFile } from './imageTypes';

export function supportsFileImport(): boolean {
  return true;
}

/** Selector de archivos del sistema (`File.pickFileAsync`, ADR 0038): mismo patrón que `imageFiles.android.ts`. */
export async function pickLibraryFile(): Promise<PickedFile | null> {
  const picked = await File.pickFileAsync({ mimeTypes: [...LIBRARY_FILE_MIME_TYPES] });
  if (picked.canceled) return null;
  const file = picked.result;
  return { bytes: await file.bytes(), name: file.name };
}
