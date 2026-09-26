/**
 * Constantes y tipos compartidos por los selectores de imagen de cada plataforma. Van en un módulo
 * neutro: desde imageFiles.android.ts, './imageFiles' se resolvería a sí mismo en Android.
 */
export interface PickedFile {
  readonly bytes: Uint8Array;
  readonly name: string;
}

/** Tipos que se ofrecen en el selector; la validación real es por firma (ADR 0015). */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
