import { isValidAssetRef } from '@noutynotes/domain';
import type { AssetRef } from '@noutynotes/domain';

import { fail, storageIssue, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';

export const MAX_PATH_LENGTH = 1024;
export const MAX_SEGMENT_LENGTH = 255;

const RESERVED_CHARACTERS = /[<>:"|?*]/;
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Texto Unicode bien formado: cada sustituto alto (0xD800–0xDBFF) va seguido de uno bajo
 * (0xDC00–0xDFFF) y no hay bajos sueltos. Un sustituto aislado no tiene representación UTF-8,
 * así que no puede ser un nombre de archivo portable ni codificarse en un enlace.
 */
function isWellFormedText(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    }
  }
  return true;
}

function segmentProblem(segment: string): string | null {
  if (segment === '') return 'Contiene segmentos vacíos.';
  if (!isWellFormedText(segment)) return 'Contiene sustitutos UTF-16 aislados; no es Unicode válido.';
  if (segment === '.' || segment === '..') return 'No admite segmentos "." ni "..".';
  if (segment.length > MAX_SEGMENT_LENGTH) return `Un segmento supera ${MAX_SEGMENT_LENGTH} caracteres.`;
  if ([...segment].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return 'Contiene caracteres de control.';
  if (RESERVED_CHARACTERS.test(segment)) return 'Contiene caracteres reservados en Windows (<>:"|?*).';
  if (/[. ]$/.test(segment) || segment.startsWith(' ')) return 'Un segmento no puede empezar por espacio ni terminar en punto o espacio.';
  if (DEVICE_NAME.test(segment)) return `"${segment}" es un nombre de dispositivo reservado en Windows.`;
  return null;
}

function pathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'Debe ser una ruta relativa no vacía.';
  if (path.length > MAX_PATH_LENGTH) return `Supera ${MAX_PATH_LENGTH} caracteres.`;
  if (path.includes('\\')) return 'Usa "/" como separador; no se admiten barras invertidas.';
  if (path.startsWith('/')) return 'Debe ser relativa a la raíz del paquete.';
  if (/^[a-z]:/i.test(path)) return 'No admite letras de unidad.';
  for (const segment of path.split('/')) {
    const problem = segmentProblem(segment);
    if (problem) return problem;
  }
  return null;
}

/** Ruta relativa portable entre Windows, macOS, Linux y Android, con `/` como separador. */
export function collectPortablePathIssues(path: unknown, issuePath: string, issues: StorageIssue[]): void {
  const problem = pathProblem(path);
  if (problem) issues.push(storageIssue('invalid-path', issuePath, problem));
}

export function validatePortablePath(path: unknown): StorageResult<string> {
  const issues: StorageIssue[] = [];
  collectPortablePathIssues(path, 'path', issues);
  return issues.length > 0 ? fail(issues) : succeed(path as string);
}

/** Ruta portable que además cumple el contrato de AssetRef del dominio. */
export function isPortableAssetRef(value: unknown): value is AssetRef {
  return isValidAssetRef(value) && pathProblem(value) === null;
}

// Además de lo que codifica encodeURIComponent, se codifican ( ) ' ! para no cerrar un enlace Markdown.
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[()'!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch (error) {
    // Solo una secuencia % mal formada se traduce a incidencia; cualquier otro error se propaga.
    if (error instanceof URIError) return null;
    throw error;
  }
}

function directoryOf(file: string): string[] {
  return file.split('/').slice(0, -1);
}

/**
 * Enlace relativo desde `fromFile` hasta un asset, ambos relativos a la raíz. Codifica cada
 * segmento; no modifica ningún Markdown existente.
 */
export function assetRefToMarkdownLink(fromFile: string, assetRef: string): StorageResult<string> {
  const issues: StorageIssue[] = [];
  collectPortablePathIssues(fromFile, 'fromFile', issues);
  if (!isPortableAssetRef(assetRef)) issues.push(storageIssue('invalid-path', 'assetRef', 'Debe ser una referencia de asset portable.'));
  if (issues.length > 0) return fail(issues);
  const from = directoryOf(fromFile);
  const target = assetRef.split('/');
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) common += 1;
  const up = Array.from({ length: from.length - common }, () => '..');
  return succeed([...up, ...target.slice(common).map(encodeSegment)].join('/'));
}

/**
 * Interpreta un enlace relativo de un documento como AssetRef desde la raíz. Rechaza URLs,
 * rutas absolutas, consultas, fragmentos, codificaciones inválidas y salidas del paquete.
 */
export function markdownLinkToAssetRef(fromFile: string, href: string): StorageResult<AssetRef> {
  const fromIssues: StorageIssue[] = [];
  collectPortablePathIssues(fromFile, 'fromFile', fromIssues);
  if (fromIssues.length > 0) return fail(fromIssues);
  const invalid = (message: string): StorageResult<AssetRef> => fail([storageIssue('invalid-link', 'href', message)]);
  if (typeof href !== 'string' || href.length === 0) return invalid('El enlace está vacío.');
  if (href.includes('\\')) return invalid('No admite barras invertidas.');
  if (SCHEME.test(href)) return invalid('No admite URLs, esquemas ni letras de unidad.');
  if (href.startsWith('/')) return invalid('Debe ser relativo al documento.');
  if (/[?#]/.test(href)) return invalid('No admite consultas ni fragmentos.');

  const resolved = directoryOf(fromFile);
  for (const raw of href.split('/')) {
    const segment = decodeSegment(raw);
    if (segment === null) return invalid('Contiene una codificación % inválida.');
    if (segment.includes('/') || segment.includes('\\')) return invalid('Un segmento codificado no puede contener separadores.');
    if (segment === '') return invalid('Contiene segmentos vacíos.');
    if (segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) return invalid('Sale de la raíz del paquete.');
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  const ref = resolved.join('/');
  return isPortableAssetRef(ref) ? succeed(ref) : invalid('El destino no es una referencia de asset portable.');
}
