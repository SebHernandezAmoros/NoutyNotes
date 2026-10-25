import { expect, it } from 'vitest';
import { validateWorkspace } from '@noutynotes/domain';
import type { Card, RichTextBlock, Workspace } from '@noutynotes/domain';
import { analyzeAssetReferences } from './asset-reference-analysis';
import { prepareAssetDetachmentCandidate } from './asset-detachment-candidate';
import { auxiliaryRef, detachmentPdfRef, detachmentRef, detachmentWorkspace } from '../../../tests/fixtures/asset-detachment';

const text = (value: string): RichTextBlock => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const image = { type: 'image' as const, assetRef: detachmentRef, alt: 'Alt independiente', caption: [{ type: 'text' as const, text: 'Leyenda exacta', marks: ['bold'] as const }], captionPolicy: 'explicit' as const, accessibilityIntent: 'pending' as const, size: 'medium' as const, alignment: 'right' as const };
const analyze = (snapshot: Workspace, ref = detachmentRef) => analyzeAssetReferences({ workspace: snapshot, ref, unverified: [] });
const firstNote = (blocks: readonly RichTextBlock[]): Workspace => {
  const source = detachmentWorkspace();
  return { ...source, cards: source.cards.map((card, index): Card => index === 0 ? { ...card, contentDocument: { schemaVersion: 2, blocks } } : card) };
};

it('ensaya todas las apariciones compartidas y restaurables en una copia, sin autorizar ejecución', () => {
  const snapshot = detachmentWorkspace();
  const before = structuredClone(snapshot);
  const analysis = analyzeAssetReferences({ workspace: snapshot, ref: detachmentRef, unverified: ['Otras sesiones'] });
  const result = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentRef, analysis });
  expect(result.status).toBe('prepared-copy');
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));
  expect(validateWorkspace(result.snapshot).ok).toBe(true);
  expect(analyzeAssetReferences({ workspace: result.snapshot, ref: detachmentRef, unverified: [] }).occurrenceCount).toBe(0);
  expect(result.snapshot.cards[0]?.contentDocument?.blocks.filter((block) => block.type === 'retired-image')).toHaveLength(3);
  expect(result.snapshot.cards[1]?.primaryResourceState).toEqual({ kind: 'retired', resourceKind: 'image' });
  expect(result.snapshot.archive?.[0]?.card.contentDocument?.blocks[0]?.type).toBe('retired-image');
  expect(result.snapshot.trash?.[0]?.card.contentDocument?.blocks[0]?.type).toBe('retired-image');
  expect(result.executionAllowed).toBe(false);
  expect(snapshot).toEqual(before);
});

it('remove-block usa índices originales y excepciones; conserva vecinos, otros Assets y metadatos', () => {
  const other = { ...image, assetRef: auxiliaryRef };
  const snapshot = firstNote([text('Antes'), image, text('Entre'), image, other, text('Después')]);
  const analysis = analyze(snapshot);
  const occurrence = analysis.occurrences.filter((entry) => entry.kind === 'rich-image' && entry.ownerId === analysis.owners[0]?.id)[1]!;
  const result = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentRef, analysis, noteImagePolicy: 'remove-block',
    exceptions: { sourceSnapshot: analysis.sourceSnapshot!, values: [{ occurrenceId: occurrence.id, policy: 'keep-marker' }] } });
  expect(result.status).toBe('prepared-copy');
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));
  const { assetRef: _ref, ...metadata } = image;
  expect(result.snapshot.cards[0]?.contentDocument).toEqual({ schemaVersion: 3, blocks: [text('Antes'), text('Entre'), { ...metadata, type: 'retired-image' }, other, text('Después')] });
  expect(result.snapshot.layouts).toEqual(snapshot.layouts);
  expect(result.snapshot.boards).toEqual(snapshot.boards);
  expect(result.snapshot.relations).toEqual(snapshot.relations);
  expect(result.snapshot.archive?.[0]?.boards).toEqual(snapshot.archive?.[0]?.boards);
  expect(result.snapshot.cards[0]?.title).toBe(snapshot.cards[0]?.title);
  expect(result.snapshot.cards[0]?.fields).toEqual(snapshot.cards[0]?.fields);
});

it('un documento sin bloques restantes recibe un párrafo vacío válido sin cambio de versión innecesario', () => {
  const snapshot = firstNote([image]);
  const result = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentRef, analysis: analyze(snapshot), noteImagePolicy: 'remove-block' });
  expect(result.status).toBe('prepared-copy');
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));
  expect(result.snapshot.cards[0]?.contentDocument).toEqual({ schemaVersion: 2, blocks: [{ type: 'paragraph', content: [] }] });
  const repeated = prepareAssetDetachmentCandidate({ snapshot: result.snapshot, assetRef: detachmentRef, analysis: analyze(result.snapshot) });
  expect(repeated.status).toBe('prepared-copy');
  if (repeated.status !== 'prepared-copy') throw new Error(JSON.stringify(repeated));
  expect(repeated.snapshot).toEqual(result.snapshot); // Deterministic copy, not durable-operation idempotence.
});

it('conserva una tarjeta PDF y no toca referencias a otros recursos', () => {
  const snapshot = detachmentWorkspace();
  const result = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentPdfRef, analysis: analyze(snapshot, detachmentPdfRef) });
  expect(result.status).toBe('prepared-copy');
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));
  const pdf = result.snapshot.cards.find((card) => card.id === 'pdf-card');
  expect(pdf).toEqual({ ...snapshot.cards.find((card) => card.id === 'pdf-card'), assetRefs: [], primaryResourceState: { kind: 'retired', resourceKind: 'pdf' } });
  expect(result.snapshot.cards[0]).toEqual(snapshot.cards[0]);
  expect(analyze(result.snapshot).occurrenceCount).toBe(analyze(snapshot).occurrenceCount);
});

it('cero usos conocidos permite ensayar una copia idéntica pero nunca borrar', () => {
  const snapshot = detachmentWorkspace();
  const absent = 'assets/images/no-utilizado.png' as typeof detachmentRef;
  const result = prepareAssetDetachmentCandidate({ snapshot, assetRef: absent, analysis: analyze(snapshot, absent) });
  expect(result.status).toBe('prepared-copy');
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));
  expect(result.snapshot).toEqual(snapshot);
  expect(result.executionAllowed).toBe(false);
  expect(result.plan.executionBlockers.length).toBeGreaterThan(0);
});

it('rechaza snapshot obsoleto y decisiones de otra versión sin devolver una candidata parcial', () => {
  const snapshot = detachmentWorkspace();
  const analysis = analyze(snapshot);
  const changed = { ...snapshot, metadata: { ...snapshot.metadata, name: 'Cambió' } };
  const stale = prepareAssetDetachmentCandidate({ snapshot: changed, assetRef: detachmentRef, analysis });
  expect(stale.status).toBe('blocked');
  expect(stale).not.toHaveProperty('snapshot');
  const foreign = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentRef, analysis,
    exceptions: { sourceSnapshot: JSON.stringify(changed), values: [] } });
  expect(foreign.status).toBe('blocked');
  expect(foreign).not.toHaveProperty('snapshot');
});

it('referencias auxiliares o dependencias sin contrato bloquean todo el ensayo', () => {
  const snapshot = detachmentWorkspace();
  const unsupported = prepareAssetDetachmentCandidate({ snapshot, assetRef: auxiliaryRef, analysis: analyze(snapshot, auxiliaryRef) });
  expect(unsupported.status).toBe('blocked');
  expect(unsupported).not.toHaveProperty('snapshot');
  const dependent = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentRef,
    analysis: analyzeAssetReferences({ workspace: snapshot, ref: detachmentRef, unverified: [], dependencies: [{ kind: 'custom-font', ref: detachmentRef, label: 'Dependencia' }] }) });
  expect(dependent.status).toBe('blocked');
  expect(dependent).not.toHaveProperty('snapshot');
});

it('leyenda enlazada nunca se simplifica para forzar un marcador; remove-block debe ser explícito', () => {
  const linked = { ...image, caption: [{ type: 'link' as const, href: 'https://example.com', content: [{ type: 'text' as const, text: 'Enlace legítimo' }] }] };
  const snapshot = firstNote([text('Antes'), linked, text('Después')]);
  const input = { snapshot, assetRef: detachmentRef, analysis: analyze(snapshot) };
  expect(prepareAssetDetachmentCandidate(input).status).toBe('blocked');
  const removal = prepareAssetDetachmentCandidate({ ...input, noteImagePolicy: 'remove-block' });
  expect(removal.status).toBe('prepared-copy');
  if (removal.status !== 'prepared-copy') throw new Error(JSON.stringify(removal));
  expect(removal.snapshot.cards[0]?.contentDocument?.blocks).toEqual([text('Antes'), text('Después')]);
  expect(snapshot.cards[0]?.contentDocument?.blocks[1]).toEqual(linked);
});

it('Markdown sin parche lossless y campos Asset impiden devolver una transformación parcial', () => {
  const source = detachmentWorkspace();
  const { contentDocument: _doc, ...main } = source.cards[0]!;
  const markdown = { ...source, cards: [{ ...main, content: `Antes\n\n![alt](${detachmentRef})\n\nDespués` }, ...source.cards.slice(1)] };
  expect(prepareAssetDetachmentCandidate({ snapshot: markdown, assetRef: detachmentRef, analysis: analyze(markdown) }).status).toBe('blocked');
  const fields = { ...source, cards: source.cards.map((card, index) => index === 0 ? { ...card, fields: { ...card.fields, cover: detachmentRef } } : card) };
  expect(prepareAssetDetachmentCandidate({ snapshot: fields, assetRef: detachmentRef, analysis: analyze(fields) }).status).toBe('blocked');
});

it('la candidata y el plan no comparten objetos mutables con la fuente ni entre sí', () => {
  const snapshot = firstNote([image]);
  const before = structuredClone(snapshot);
  const result = prepareAssetDetachmentCandidate({ snapshot, assetRef: detachmentRef, analysis: analyze(snapshot) });
  expect(result.status).toBe('prepared-copy');
  if (result.status !== 'prepared-copy') throw new Error(JSON.stringify(result));
  const marker = result.snapshot.cards[0]!.contentDocument!.blocks[0]!;
  if (marker.type !== 'retired-image') throw new Error('Missing marker');
  Object.assign(marker, { alt: 'Alterado por consumidor' });
  expect(snapshot).toEqual(before);
  const proposal = result.plan.entries[0]!.proposal;
  expect(proposal.kind).toBe('keep-marker');
  if (proposal.kind === 'keep-marker') expect(proposal.marker.alt).toBe(image.alt);
});
