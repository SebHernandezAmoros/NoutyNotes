// Constructor de ZIP solo para pruebas, independiente del lector: permite falsear cada campo.
import { deflateSync } from 'fflate';

const table = (() => {
  const values = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    values[n] = c >>> 0;
  }
  return values;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export const text = (value: string): Uint8Array => new TextEncoder().encode(value);

export interface FixtureEntry {
  readonly name: string | Uint8Array;
  readonly data: Uint8Array;
  readonly method?: number;
  readonly flags?: number;
  readonly crc?: number;
  /** Tamaño descomprimido declarado; por defecto, el real. */
  readonly declaredSize?: number;
  readonly compressedSizeOverride?: number;
  readonly externalAttributes?: number;
  readonly versionMadeBy?: number;
  /** Nombre distinto en la cabecera local. */
  readonly localName?: string;
  /** Valores de la cabecera local distintos de los del directorio central. */
  readonly localFlags?: number;
  readonly localMethod?: number;
  readonly localCrc?: number;
  readonly localCompressedSize?: number;
  readonly localSize?: number;
  /** Bit 3: CRC y tamaños a cero en la cabecera local y descriptor de datos tras el contenido. */
  readonly dataDescriptor?: boolean;
}

function bytesOf(name: string | Uint8Array): Uint8Array {
  return typeof name === 'string' ? text(name) : name;
}

/** ZIP clásico: cabeceras locales, directorio central y fin de directorio. */
export function buildZip(entries: readonly FixtureEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const payload = method === 8 ? deflateSync(entry.data) : entry.data;
    const name = bytesOf(entry.name);
    const localName = entry.localName === undefined ? name : text(entry.localName);
    const flags = (entry.flags ?? 0) | (typeof entry.name === 'string' && /[^\x00-\x7f]/.test(entry.name) ? 0x800 : 0);
    const crc = entry.crc ?? crc32(entry.data);
    const size = entry.declaredSize ?? entry.data.length;
    const compressed = entry.compressedSizeOverride ?? payload.length;

    const descriptorFlags = entry.dataDescriptor ? 0x8 : 0;
    const descriptor = entry.dataDescriptor ? 16 : 0;
    const local = new Uint8Array(30 + localName.length + payload.length + descriptor);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, entry.localFlags ?? (flags | descriptorFlags), true);
    lv.setUint16(8, entry.localMethod ?? method, true);
    lv.setUint32(14, entry.localCrc ?? (entry.dataDescriptor ? 0 : crc), true);
    lv.setUint32(18, entry.localCompressedSize ?? (entry.dataDescriptor ? 0 : compressed), true);
    lv.setUint32(22, entry.localSize ?? (entry.dataDescriptor ? 0 : size), true);
    lv.setUint16(26, localName.length, true);
    if (entry.dataDescriptor) {
      const at = 30 + localName.length + payload.length;
      lv.setUint32(at, 0x08074b50, true);
      lv.setUint32(at + 4, crc, true);
      lv.setUint32(at + 8, compressed, true);
      lv.setUint32(at + 12, size, true);
    }
    local.set(localName, 30);
    local.set(payload, 30 + localName.length);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, entry.versionMadeBy ?? 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags | descriptorFlags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, compressed, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, entry.externalAttributes ?? 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end];
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { result.set(part, at); at += part.length; }
  return result;
}

/** Paquete como entradas: texto UTF-8 para documentos y bytes tal cual para assets. */
export function entriesOf(files: Readonly<Record<string, string>>, assets: Readonly<Record<string, Uint8Array>> = {}, prefix = ''): FixtureEntry[] {
  return [
    ...Object.entries(files).map(([path, content]) => ({ name: prefix + path, data: text(content) })),
    ...Object.entries(assets).map(([path, bytes]) => ({ name: prefix + path, data: bytes })),
  ];
}
