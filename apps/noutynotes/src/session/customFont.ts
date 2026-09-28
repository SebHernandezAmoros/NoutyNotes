/**
 * Activar una fuente importada (ADR 0041, E7c): API `FontFace` del navegador, sin dependencias nuevas.
 * Solo web por ahora; en otras plataformas `noteFontFamily` cae a la reserva del sistema (ver fonts.ts).
 */

/** Nombre de familia CSS estable: el mismo `ref` siempre produce el mismo nombre. */
export function customFontFamilyName(ref: string): string {
  const base = (ref.split('/').pop() ?? ref).replace(/\.[^.]+$/, '');
  const safe = base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `noty-${safe === '' ? 'fuente' : safe}`;
}

export function supportsCustomFont(): boolean {
  return typeof document !== 'undefined' && typeof FontFace !== 'undefined';
}

/**
 * Registra la fuente en el documento si no lo estaba ya. No lanza: si el navegador rechaza los bytes
 * (no es TTF/OTF válido, ya lo comprobó `inspectFont`, pero un archivo dañado igual podría fallar aquí),
 * devuelve `false` y el texto sigue legible con la reserva del sistema.
 */
export async function activateCustomFont(ref: string, bytes: Uint8Array): Promise<boolean> {
  if (!supportsCustomFont()) return false;
  const family = customFontFamilyName(ref);
  if ([...document.fonts].some((face) => face.family === family)) return true;
  try {
    const face = new FontFace(family, bytes.slice().buffer);
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}
