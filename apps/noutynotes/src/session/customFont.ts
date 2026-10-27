/** Session-only identities; no filename-based reuse or durable CSS. */
const loaded = new Map<string, { family: string; bytes: Uint8Array }>();
const requests = new Map<string, number>();
const jobs = new Map<string, { bytes: Uint8Array; promise: Promise<boolean> }>();
const faces = new Map<string, Set<FontFace>>();
let sequence = 0;
const keyOf = (ref: string, scope: string) => JSON.stringify([scope, ref]);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
export function customFontFamilyName(ref: string, scope = ''): string { return loaded.get(keyOf(ref, scope))?.family ?? 'noty-unavailable'; }
export function supportsCustomFont(): boolean { return typeof document !== 'undefined' && typeof FontFace !== 'undefined'; }
export async function activateCustomFont(ref: string, bytes: Uint8Array, scope = ''): Promise<boolean> {
  if (!supportsCustomFont()) return false;
  const key = keyOf(ref, scope);
  const job = jobs.get(key);
  if (job && equal(job.bytes, bytes)) return job.promise;
  const request = ++sequence;
  requests.set(key, request);
  const previous = loaded.get(key);
  if (previous && equal(previous.bytes, bytes) && [...document.fonts].some((face) => face.family === previous.family)) { jobs.delete(key); return true; }
  const family = 'noty-session-' + request;
  const copy = bytes.slice();
  const promise = (async () => {
    try {
      const face = new FontFace(family, copy.buffer);
      await face.load();
      if (requests.get(key) !== request) return false;
      document.fonts.add(face);
      const group = faces.get(scope) ?? new Set<FontFace>(); group.add(face); faces.set(scope, group);
      loaded.set(key, { family, bytes: copy });
      return true;
    } catch { return false; }
  })();
  jobs.set(key, { bytes: copy, promise });
  const result = await promise;
  if (jobs.get(key)?.promise === promise) jobs.delete(key);
  return result;
}
export function releaseCustomFonts(scope: string): void {
  if (supportsCustomFont()) for (const face of faces.get(scope) ?? []) document.fonts.delete(face);
  faces.delete(scope);
  for (const key of requests.keys()) if ((JSON.parse(key) as string[])[0] === scope) { requests.delete(key); jobs.delete(key); loaded.delete(key); }
}
