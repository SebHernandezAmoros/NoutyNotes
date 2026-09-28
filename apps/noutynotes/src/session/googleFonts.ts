/**
 * Google Fonts (ADR 0042): descarga explícita mediante la API pública `css2` (sin clave de API, a
 * diferencia de la Developer API), confirmada con CORS abierto (`Access-Control-Allow-Origin: *`)
 * contra el servidor real antes de programar. Solo la variante regular (400); del bloque `@font-face`
 * devuelto se usa el subconjunto «latin» (alfabeto de la interfaz, ES/EN) o el único bloque si no hay
 * subconjuntos. El formato que sirve un navegador moderno es WOFF2 (`inspectFont`, ADR 0041, lo admite).
 * No hay clave de licencia por familia en ninguna API pública: la persona la comprueba en fonts.google.com.
 */

export interface GoogleFontResult {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

export type GoogleFontFailureReason = 'empty' | 'network' | 'notFound' | 'parse';

export type GoogleFontOutcome =
  | { readonly ok: true; readonly value: GoogleFontResult }
  | { readonly ok: false; readonly reason: GoogleFontFailureReason };

const cssUrl = (family: string) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;

/** El bloque `/* latin *\/` si existe; si no, todo el documento (una sola variante, sin subconjuntos). */
function extractFontUrl(css: string): string | null {
  const latinBlock = /\/\*\s*latin\s*\*\/\s*@font-face\s*\{[^}]*\}/i.exec(css)?.[0] ?? css;
  return /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/i.exec(latinBlock)?.[1] ?? null;
}

export function supportsGoogleFonts(): boolean {
  return typeof fetch === 'function';
}

/** Descarga la variante regular de una familia. Nunca lanza: cualquier fallo vuelve como `reason`. */
export async function fetchGoogleFont(family: string): Promise<GoogleFontOutcome> {
  const name = family.trim();
  if (name === '') return { ok: false, reason: 'empty' };
  let cssResponse;
  try {
    cssResponse = await fetch(cssUrl(name));
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!cssResponse.ok) return { ok: false, reason: 'notFound' };
  const url = extractFontUrl(await cssResponse.text());
  if (!url) return { ok: false, reason: 'parse' };
  let fileResponse;
  try {
    fileResponse = await fetch(url);
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!fileResponse.ok) return { ok: false, reason: 'network' };
  const bytes = new Uint8Array(await fileResponse.arrayBuffer());
  return { ok: true, value: { bytes, fileName: `${name}.woff2` } };
}
