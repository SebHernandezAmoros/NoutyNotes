import { Inflate } from 'fflate';

import { fail, storageIssue, succeed } from './issues';
import type { StorageIssue, StorageResult } from './issues';

/** Límites de lectura (ADR 0011). Se comprueban antes de descomprimir y durante la descompresión. */
export interface ArchiveLimits {
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export interface ZipEntry {
  readonly name: string;
  readonly directory: boolean;
  readonly bytes: Uint8Array;
}

const ARCHIVE = 'archivo';
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;
/** Bloques pequeños: deflate expande como máximo ~1032:1, así cada paso produce unos 4 MiB como mucho. */
const INFLATE_CHUNK = 4096;
const utf8 = new TextDecoder('utf-8', { fatal: true });

const crcTable = (() => {
  const values = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    values[n] = c >>> 0;
  }
  return values;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crcTable[(crc ^ (bytes[index] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface CentralRecord {
  readonly label: string;
  readonly name: string;
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
  readonly directory: boolean;
}

function invalid<T>(path: string, message: string): StorageResult<T> {
  return fail([storageIssue('invalid-archive', path, message)]);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function findEnd(view: DataView): number {
  const last = view.byteLength - 22;
  const first = Math.max(0, last - 0xffff);
  for (let at = last; at >= first; at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  return -1;
}

interface CentralDirectory {
  readonly records: readonly CentralRecord[];
  readonly offset: number;
}

const ENCRYPTED = 0x1;
const DATA_DESCRIPTOR = 0x8;

/** Lee el directorio central sin descomprimir nada; cualquier incidencia detiene la lectura. */
function readCentralDirectory(view: DataView, bytes: Uint8Array, limits: ArchiveLimits): StorageResult<CentralDirectory> {
  const end = findEnd(view);
  if (end < 0) return invalid(ARCHIVE, 'No es un archivo ZIP o está incompleto.');
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (disk !== 0 || centralDisk !== 0 || view.getUint16(end + 8, true) !== count) return invalid(ARCHIVE, 'No se admiten ZIP divididos en varias partes.');
  if (count === 0xffff || centralSize === ZIP64_MARKER || centralOffset === ZIP64_MARKER) return invalid(ARCHIVE, 'No se admite ZIP64.');
  if (count > limits.maxEntries) return fail([storageIssue('limit-exceeded', ARCHIVE, `Supera ${limits.maxEntries} entradas.`)]);
  if (centralOffset + centralSize > end) return invalid(ARCHIVE, 'El directorio central no cabe en el archivo.');

  const records: CentralRecord[] = [];
  const issues: StorageIssue[] = [];
  let total = 0;
  let at = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL_HEADER) return invalid(ARCHIVE, 'Directorio central dañado.');
    const madeBy = view.getUint16(at + 4, true);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const external = view.getUint32(at + 38, true);
    const localOffset = view.getUint32(at + 42, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end) return invalid(ARCHIVE, 'Directorio central dañado.');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    at = next;

    let name: string;
    try {
      name = utf8.decode(nameBytes);
    } catch {
      issues.push(storageIssue('invalid-path', `entrada ${index}`, 'El nombre no es UTF-8 válido.'));
      continue;
    }
    const label = name;
    const directory = name.endsWith('/');
    if (flags & 1) issues.push(storageIssue('invalid-archive', label, 'No se admiten entradas cifradas.'));
    else if (method !== 0 && method !== 8) issues.push(storageIssue('invalid-archive', label, `Método de compresión no admitido (${method}).`));
    else if (compressedSize === ZIP64_MARKER || size === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
      issues.push(storageIssue('invalid-archive', label, 'No se admite ZIP64.'));
    } else if (madeBy >>> 8 === 3 && ((external >>> 16) & 0o170000) === 0o120000) {
      issues.push(storageIssue('invalid-archive', label, 'No se admiten enlaces simbólicos.'));
    } else if (size > limits.maxEntryBytes) {
      issues.push(storageIssue('limit-exceeded', label, `Supera ${limits.maxEntryBytes} bytes descomprimidos.`));
    } else if (directory && size !== 0) {
      issues.push(storageIssue('invalid-archive', label, 'Un directorio no puede tener contenido.'));
    }
    total += size;
    records.push({ label, name, nameBytes, flags, method, crc, compressedSize, size, localOffset, directory });
  }
  if (issues.length > 0) return fail(issues);
  if (total > limits.maxTotalBytes) return fail([storageIssue('limit-exceeded', ARCHIVE, `Supera ${limits.maxTotalBytes} bytes descomprimidos en total.`)]);
  return succeed({ records, offset: centralOffset });
}

/**
 * La cabecera local debe describir la misma entrada que el directorio central: mismo nombre, bits
 * de cifrado y de descriptor, método y, sin descriptor de datos, el mismo CRC y tamaños. Con
 * descriptor (bit 3) la cabecera local puede llevar ceros; si trae valores, deben coincidir.
 */
function localMatches(view: DataView, at: number, record: CentralRecord, name: Uint8Array): boolean {
  const flags = view.getUint16(at + 6, true);
  const method = view.getUint16(at + 8, true);
  const crc = view.getUint32(at + 14, true);
  const compressedSize = view.getUint32(at + 18, true);
  const size = view.getUint32(at + 22, true);
  if (!sameBytes(name, record.nameBytes)) return false;
  if ((flags & ENCRYPTED) !== (record.flags & ENCRYPTED) || (flags & DATA_DESCRIPTOR) !== (record.flags & DATA_DESCRIPTOR)) return false;
  if (method !== record.method) return false;
  const deferred = (record.flags & DATA_DESCRIPTOR) !== 0;
  const agrees = (local: number, central: number) => local === central || (deferred && local === 0);
  return agrees(crc, record.crc) && agrees(compressedSize, record.compressedSize) && agrees(size, record.size);
}

const OVERFLOW = Symbol('overflow');

/** Descomprime por bloques y corta en cuanto la salida real supera el tamaño declarado. */
function inflate(data: Uint8Array, declared: number): Uint8Array | typeof OVERFLOW | null {
  const output = new Uint8Array(declared);
  let produced = 0;
  let overflow = false;
  const inflater = new Inflate((chunk) => {
    if (produced + chunk.length > declared) {
      overflow = true;
      throw new Error('overflow');
    }
    output.set(chunk, produced);
    produced += chunk.length;
  });
  try {
    if (data.length === 0) inflater.push(new Uint8Array(0), true);
    for (let offset = 0; offset < data.length; offset += INFLATE_CHUNK) {
      inflater.push(data.subarray(offset, offset + INFLATE_CHUNK), offset + INFLATE_CHUNK >= data.length);
    }
  } catch {
    return overflow ? OVERFLOW : null;
  }
  return produced === declared ? output : null;
}

/**
 * Lee un ZIP no confiable: límites, directorio central, cabeceras locales coherentes, métodos
 * stored/deflate, CRC-32 y salida acotada. No valida rutas ni formato: lo hace el llamador.
 */
export function readZip(input: Uint8Array, limits: ArchiveLimits): StorageResult<readonly ZipEntry[]> {
  if (input.length > limits.maxArchiveBytes) return fail([storageIssue('limit-exceeded', ARCHIVE, `El ZIP supera ${limits.maxArchiveBytes} bytes.`)]);
  if (input.length < 22) return invalid(ARCHIVE, 'No es un archivo ZIP o está incompleto.');
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const central = readCentralDirectory(view, input, limits);
  if (!central.ok) return central;
  const { records, offset: centralOffset } = central.value;
  // Cada entrada solo puede ocupar el tramo hasta la siguiente cabecera local o el directorio central.
  const starts = [...new Set(records.map((record) => record.localOffset))].sort((a, b) => a - b);
  const boundaryAfter = (offset: number) => starts.find((start) => start > offset) ?? centralOffset;

  const entries: ZipEntry[] = [];
  for (const record of records) {
    const at = record.localOffset;
    if (at + 30 > centralOffset || view.getUint32(at, true) !== LOCAL_HEADER) return invalid(record.label, 'Cabecera local ausente o dañada.');
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    if (!localMatches(view, at, record, input.subarray(at + 30, at + 30 + nameLength))) {
      return invalid(record.label, 'La cabecera local no coincide con el directorio central.');
    }
    const start = at + 30 + nameLength + extraLength;
    if (start + record.compressedSize > boundaryAfter(at)) return invalid(record.label, 'Los datos de la entrada se salen de su zona del ZIP.');
    const data = input.subarray(start, start + record.compressedSize);
    if (record.directory) {
      entries.push({ name: record.name, directory: true, bytes: new Uint8Array() });
      continue;
    }
    let bytes: Uint8Array;
    if (record.method === 0) {
      if (record.compressedSize !== record.size) return invalid(record.label, 'El tamaño almacenado no coincide con el declarado.');
      bytes = data.slice();
    } else {
      const inflated = inflate(data, record.size);
      if (inflated === OVERFLOW) return fail([storageIssue('limit-exceeded', record.label, 'El contenido descomprimido supera el tamaño declarado.')]);
      if (inflated === null) return invalid(record.label, 'Los datos comprimidos están dañados.');
      bytes = inflated;
    }
    if (crc32(bytes) !== record.crc) return invalid(record.label, 'La suma de comprobación (CRC-32) no coincide.');
    entries.push({ name: record.name, directory: false, bytes });
  }
  return succeed(entries);
}
