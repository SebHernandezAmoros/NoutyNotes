import { noteImageRefs, richTextAssetRefs } from '@noutynotes/domain';
import type { Card, Workspace } from '@noutynotes/domain';
import { zipSync } from 'fflate';

import { inspectTransactionMarker } from './folder-storage';
import type { WorkspaceDirectory } from './folder-storage';
import { validatePortablePath } from './paths';
import { ARCHIVE_LIMITS, readWorkspaceArchive, writeWorkspaceArchive } from './workspace-archive';
import type { BinaryAssets } from './workspace-archive';
import { parseWorkspace } from './workspace-codec';
import type { TextFiles } from './text-files';
import { readZip } from './zip';

const MARKER = '.nouty-transaction.json';
const utf8 = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const FIXED_TIME = '1980-01-01T00:00:00';

export type MarkerCopyBlock = 'read-failure' | 'marker-missing' | 'marker-valid' | 'incompatible-version'
  | 'ambiguous-artifact' | 'deleted-source' | 'snapshot-changed' | 'invalid-text' | 'invalid-workspace' | 'missing-asset'
  | 'archive-invalid' | 'evidence-unavailable';
export type MarkerCopyResult =
  | { readonly status: 'candidate'; readonly markerReason: string; readonly workspace: Workspace;
      readonly files: TextFiles; readonly assets: BinaryAssets; readonly archive: Uint8Array;
      readonly evidence: Uint8Array; readonly fileCount: number }
  | { readonly status: 'blocked'; readonly reason: MarkerCopyBlock; readonly markerReason: string | null;
      readonly evidence?: Uint8Array; readonly unreadableCount: number };

type Snapshot = { readonly files: ReadonlyMap<string, Uint8Array>; readonly unreadable: readonly string[]; readonly listed: readonly string[] };

/** Solo list/read; el caller web además proporciona un WorkspaceDirectory con write/remove deshabilitados. */
async function readSnapshot(directory: WorkspaceDirectory): Promise<Snapshot> {
  const listed = [...await directory.listPaths()].sort();
  const files = new Map<string, Uint8Array>();
  const unreadable: string[] = [];
  let total = 0;
  for (const path of listed) {
    if (!validatePortablePath(path).ok || files.has(path)) { unreadable.push(path); continue; }
    try {
      const bytes = await directory.read(path);
      if (!bytes) { unreadable.push(path); continue; }
      total += bytes.length;
      if (total > ARCHIVE_LIMITS.maxTotalBytes) { unreadable.push(path); continue; }
      files.set(path, bytes.slice());
    } catch { unreadable.push(path); }
  }
  return { files, unreadable, listed };
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (a.listed.length !== b.listed.length || a.unreadable.length || b.unreadable.length) return false;
  return a.listed.every((path, index) => {
    if (path !== b.listed[index]) return false;
    const left = a.files.get(path); const right = b.files.get(path);
    return !!left && !!right && equalBytes(left, right);
  });
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** ZIP de evidencia separado del formato Workspace: todos los bytes legibles bajo source/. */
function evidenceZip(snapshot: Snapshot, markerReason: string | null): Uint8Array | undefined {
  if (snapshot.listed.length + 1 > ARCHIVE_LIMITS.maxEntries) return undefined;
  const entries: [string, Uint8Array][] = [];
  for (const [path, bytes] of snapshot.files) {
    if (bytes.length > ARCHIVE_LIMITS.maxEntryBytes) return undefined;
    entries.push([`source/${path}`, bytes]);
  }
  const manifest = encoder.encode(JSON.stringify({ version: 1, kind: 'nouty-recovery-evidence',
    markerPath: MARKER, markerReason, observedPaths: snapshot.listed,
    unreadablePaths: snapshot.unreadable, complete: snapshot.unreadable.length === 0 }));
  entries.push(['diagnostic.json', manifest]);
  try {
    const result = zipSync(Object.fromEntries(entries), { level: 6, mtime: FIXED_TIME });
    if (result.length > ARCHIVE_LIMITS.maxArchiveBytes) return undefined;
    const checked = readZip(result, ARCHIVE_LIMITS);
    if (!checked.ok || checked.value.filter((entry) => !entry.directory).length !== entries.length) return undefined;
    if (entries.some(([path, bytes]) => !equalBytes(checked.value.find((entry) => entry.name === path)?.bytes ?? new Uint8Array(), bytes))) return undefined;
    return result;
  } catch { return undefined; }
}

function knownAssetReferences(workspace: Workspace): Set<string> {
  const refs = new Set<string>();
  const visit = (card: Card) => {
    card.assetRefs?.forEach((ref) => refs.add(ref));
    if (card.noteFont?.kind === 'asset') refs.add(card.noteFont.assetRef);
    if (card.content) noteImageRefs(card.content).forEach((ref) => refs.add(ref));
    if (card.contentDocument) richTextAssetRefs(card.contentDocument).forEach((ref) => refs.add(ref));
    const type = workspace.cardTypes.find((entry) => entry.id === card.typeId);
    for (const field of type?.fields ?? []) {
      if (field.kind !== 'asset') continue;
      const value = card.fields[field.key];
      if (typeof value === 'string') refs.add(value);
    }
  };
  workspace.cards.forEach(visit);
  workspace.archive?.forEach((entry) => visit(entry.card));
  workspace.trash?.forEach((entry) => visit(entry.card));
  return refs;
}

/** Evalúa exclusivamente una carpeta con marcador inválido. No ejecuta rollback ni modifica la fuente. */
export async function prepareInvalidMarkerCopy(directory: WorkspaceDirectory): Promise<MarkerCopyResult> {
  let first: Snapshot;
  try { first = await readSnapshot(directory); }
  catch { return { status: 'blocked', reason: 'read-failure', markerReason: null, unreadableCount: 0 }; }
  const markerBytes = first.files.get(MARKER);
  const marker = markerBytes ? inspectTransactionMarker(markerBytes) : null;
  const markerReason = marker && marker.kind !== 'valid' ? marker.reason : null;
  const evidence = evidenceZip(first, markerReason);
  const blocked = (reason: MarkerCopyBlock): MarkerCopyResult => ({ status: 'blocked', reason, markerReason,
    ...(evidence ? { evidence } : {}), unreadableCount: first.unreadable.length });
  if (first.unreadable.length) return blocked('read-failure');
  if (!marker) return blocked('marker-missing');
  if (marker.kind === 'valid') return blocked('marker-valid');
  if (marker.kind === 'incompatible-version') return blocked('incompatible-version');
  if (!evidence) return blocked('evidence-unavailable');

  let second: Snapshot;
  try { second = await readSnapshot(directory); }
  catch { return blocked('read-failure'); }
  if (!sameSnapshot(first, second)) return blocked('snapshot-changed');
  if (first.files.has('.nouty-deleted')) return blocked('deleted-source');
  if (first.listed.some((path) => /(?:\.crswap|\.tmp|\.part)$/i.test(path))) return blocked('ambiguous-artifact');

  const files: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  for (const [path, bytes] of first.files) {
    if (path === MARKER || path === '.nouty-deleted') continue;
    if (path.startsWith('assets/')) { assets[path] = bytes; continue; }
    try { files[path] = utf8.decode(bytes); }
    catch { return blocked('invalid-text'); }
  }
  const parsed = parseWorkspace(files);
  if (!parsed.ok) return blocked('invalid-workspace');
  if ([...knownAssetReferences(parsed.value)].some((ref) => assets[ref] === undefined)) return blocked('missing-asset');
  const zipped = writeWorkspaceArchive(files, assets);
  if (!zipped.ok) return blocked('archive-invalid');
  const reopened = readWorkspaceArchive(zipped.value);
  if (!reopened.ok || JSON.stringify(reopened.value.files) !== JSON.stringify(files)
    || Object.keys(assets).length !== Object.keys(reopened.value.assets).length
    || Object.entries(assets).some(([path, bytes]) => !equalBytes(bytes, reopened.value.assets[path] ?? new Uint8Array()))) return blocked('archive-invalid');
  return { status: 'candidate', markerReason: marker.reason, workspace: parsed.value,
    files, assets, archive: zipped.value, evidence, fileCount: first.files.size };
}
