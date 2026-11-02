export type TextAssetPreview =
  | { readonly ok: true; readonly text: string; readonly truncated?: boolean }
  | { readonly ok: false; readonly reason: 'type' | 'encoding' };

const PREVIEW_LIMIT = 1_048_576;

/**
 * B9-R4-04: el límite protege el renderizado (decodificar/parsear en el hilo de UI), no la lectura —
 * `assets.readAsset` ya trae el archivo completo a memoria antes de llegar aquí. Un archivo más grande
 * no se rechaza por completo: se recorta en la última frontera UTF-8 válida (nunca a mitad de un
 * carácter multibyte) y se marca `truncated`, para que la interfaz lo explique en vez de bloquear la
 * vista previa entera. Reutiliza la propia validación de `TextDecoder` para encontrar esa frontera en
 * vez de reimplementar el reconocimiento de bytes UTF-8 a mano.
 */
function decodeWithinLimit(bytes: Uint8Array, limit: number): { readonly text: string; readonly truncated: boolean } | null {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  if (bytes.length <= limit) {
    try { return { text: decoder.decode(bytes), truncated: false }; } catch { return null; }
  }
  // Un carácter UTF-8 ocupa como máximo 4 bytes: basta retroceder hasta 3 posiciones desde el límite
  // para encontrar el último corte que no parta uno por la mitad.
  for (let end = limit; end > limit - 4 && end > 0; end -= 1) {
    try { return { text: decoder.decode(bytes.subarray(0, end)), truncated: true }; } catch { /* retrocede un byte más */ }
  }
  return null;
}

export function decodeTextAssetPreview(name: string, bytes: Uint8Array): TextAssetPreview {
  if (!/\.(?:txt|md|markdown)$/i.test(name)) return { ok: false, reason: 'type' };
  const decoded = decodeWithinLimit(bytes, PREVIEW_LIMIT);
  if (!decoded) return { ok: false, reason: 'encoding' };
  return decoded.truncated ? { ok: true, text: decoded.text, truncated: true } : { ok: true, text: decoded.text };
}
