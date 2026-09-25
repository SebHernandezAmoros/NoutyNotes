import type { FolderStorage } from '@noutynotes/storage';

/** Carpeta Android recordada entre sesiones (ADR 0012). */
export interface SavedFolder {
  readonly uri: string;
  readonly name: string;
}

/**
 * Fuera de Android no hay carpetas SAF: web usa File System Access (ADR 0010) o ZIP (ADR 0011).
 * La implementación real está en `androidFolder.android.ts`, que Metro elige solo en Android, así
 * que el bundle web no carga `expo-file-system`.
 */
export function supportsAndroidFolders(): boolean {
  return false;
}

export async function chooseAndroidFolder(): Promise<{ readonly storage: FolderStorage; readonly folder: SavedFolder } | null> {
  return null;
}

export function rememberAndroidFolder(_folder: SavedFolder): void {}

export function readSavedAndroidFolder(): SavedFolder | null {
  return null;
}

export function reopenAndroidFolder(_folder: SavedFolder): FolderStorage | null {
  return null;
}

export function forgetAndroidFolder(): void {}
