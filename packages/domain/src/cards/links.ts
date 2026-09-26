/** Tarjetas de enlace (ADR 0020). Puro: normalizar la URL, encontrar su campo y mostrarla sin red. */
import { failure, issue, resultOf } from '../errors';
import type { ValidationResult } from '../errors';
import type { CardTypeDefinition } from './card-type';
import { isLinkUrl } from './field-values';

/** Parece un dominio sin esquema (`ejemplo.com/ruta`): etiquetas separadas por puntos y un final de letras. */
const BARE_DOMAIN = /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?::\d+)?(?:[/?#]\S*)?$/u;

/**
 * Convierte lo que escribe la persona en un enlace admitido (`http(s)` o `mailto`), o explica el problema.
 * Sin esquema y con forma de dominio se antepone `https://`. Nunca se aceptan esquemas que ejecutan
 * código o leen archivos (`javascript:`, `data:`, `file:`…).
 */
export function normalizeLinkUrl(input: string): ValidationResult<string> {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') return failure([issue('invalid-value', 'url', 'Escribe la dirección del enlace.')]);
  const candidate = !/^[a-z][a-z0-9+.-]*:/i.test(text) && BARE_DOMAIN.test(text) ? `https://${text}` : text;
  if (!isLinkUrl(candidate)) {
    return failure([issue('invalid-value', 'url', 'Usa una dirección web (https://…) o de correo (mailto:…).')]);
  }
  return resultOf(candidate, []);
}

/** Clave del campo que guarda el enlace: el primero de clase `url` de un tipo de base `link`. */
export function linkUrlField(type: CardTypeDefinition | undefined): string | undefined {
  if (type?.base !== 'link') return undefined;
  return type.fields.find((field) => field.kind === 'url')?.key;
}

/** Dominio (o correo) y resto de la dirección, para mostrarla sin descargar nada. */
export function linkDisplay(url: string): { readonly host: string; readonly rest: string } {
  const mail = /^mailto:(.*)$/i.exec(url);
  if (mail) return { host: mail[1] ?? '', rest: '' };
  const web = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)(.*)$/i.exec(url);
  return web ? { host: web[1] ?? '', rest: web[2] ?? '' } : { host: url, rest: '' };
}
