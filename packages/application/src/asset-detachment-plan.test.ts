import { expect, it } from 'vitest';
import type { AssetRef, Card, RichTextDocument, Workspace } from '@noutynotes/domain';
import { validWorkspace } from '../../domain/src/__fixtures__/workspace';
import { analyzeAssetReferences } from './asset-reference-analysis';
import { isAssetDetachmentPlanCurrent, planAssetDetachment } from './asset-detachment-plan';
import { archiveCard, trashCard, validateRichTextDocument } from '@noutynotes/domain';

const ref = 'assets/images/mapa.png' as AssetRef;
const image = { type: 'image' as const, assetRef: ref, alt: 'Mapa', captionPolicy: 'explicit' as const, accessibilityIntent: 'pending' as const };
function notes(document: RichTextDocument = { schemaVersion: 2, blocks: [image] }): Workspace {
  const source = validWorkspace();
  return { ...source, cards: source.cards.map((card, index): Card => ({ id: card.id, typeId: card.typeId, fields: { summary: 'Conservar' },
    ...(index === 0 ? { contentDocument: document, assetRefs: [ref] } : {}) })) };
}
const analysis = (snapshot: Workspace, unverified: readonly string[] = []) => analyzeAssetReferences({ workspace: snapshot, ref, unverified });

it('propone keep-marker por defecto sin modificar el snapshot', () => {
  const snapshot = notes();
  const before = JSON.stringify(snapshot);
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: analysis(snapshot) });
  expect(plan.entries.map((entry) => entry.proposal.kind)).toEqual(['keep-marker']);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('no confunde cero referencias conocidas con permiso global ni habilita ejecución', () => {
  const snapshot = notes({ schemaVersion: 1, blocks: [{ type: 'paragraph', content: [] }] });
  const clean = { ...snapshot, cards: snapshot.cards.map(({ assetRefs: _refs, ...card }) => card) };
  const plan = planAssetDetachment({ snapshot: clean, assetRef: ref, analysis: analysis(clean) });
  expect(plan.status).toBe('reviewable');
  expect(plan.entries).toEqual([]);
  expect(plan.coverage.global).toBe(false);
  expect(plan.executionAllowed).toBe(false);
  expect(plan.executionBlockers.length).toBeGreaterThan(0);
  expect(plan.summary.filesDeleted).toBe(0);
});

it.each(['image', 'file'] as const)('conserva tarjeta primaria %s con el estado de U2-A, sin cambiar geometría o relaciones', (kind) => {
  const target = (kind === 'file' ? 'assets/documents/mapa.pdf' : ref) as AssetRef;
  const source = notes();
  const snapshot: Workspace = { ...source, cardTypes: source.cardTypes.map((type) => ({ ...type, base: kind })),
    cards: source.cards.map(({ contentDocument: _body, ...card }, index) => ({ ...card, ...(index === 0 ? { assetRefs: [target] } : {}) })) };
  const before = JSON.stringify(snapshot);
  const plan = planAssetDetachment({ snapshot, assetRef: target, analysis: analyzeAssetReferences({ workspace: snapshot, ref: target, unverified: [] }) });
  expect(plan.status).toBe('reviewable');
  expect(plan.entries[0]?.proposal).toEqual({ kind: 'retire-card', state: { kind: 'retired', resourceKind: kind === 'image' ? 'image' : 'pdf' } });
  expect(plan.summary.retainedCards).toBe(1);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('dos apariciones en una Nota tienen decisiones distintas; el carrier no es otra imagen', () => {
  const snapshot = notes({ schemaVersion: 2, blocks: [image, { ...image, alt: 'Segundo' }] });
  const inspected = analysis(snapshot);
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: inspected, exceptions: {
    sourceSnapshot: inspected.sourceSnapshot!, values: [{ occurrenceId: inspected.occurrences[1]!.id, policy: 'remove-block' }],
  } });
  expect(plan.entries.map((entry) => entry.proposal.kind)).toEqual(['keep-marker', 'remove-block']);
  expect(new Set(plan.entries.map((entry) => entry.decisionKey)).size).toBe(2);
  expect(plan.summary).toMatchObject({ owners: 1, occurrences: 2, markers: 1, removedBlocks: 1 });
  expect(plan.carriers).toHaveLength(1);
  expect(plan.carriers[0]?.proposal).toBe('synchronize-after-images');
  const marker = plan.entries[0]?.proposal;
  if (marker?.kind === 'keep-marker') expect(validateRichTextDocument({ schemaVersion: 3, blocks: [marker.marker] }).ok).toBe(true);
});

it('aplica remove-block general y una excepción keep-marker sin reescribir contenido', () => {
  const snapshot = notes({ schemaVersion: 2, blocks: [image, { ...image, alt: 'Segundo' }] });
  const inspected = analysis(snapshot);
  const before = JSON.stringify(snapshot);
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: inspected, noteImagePolicy: 'remove-block',
    exceptions: { sourceSnapshot: inspected.sourceSnapshot!, values: [{ occurrenceId: inspected.occurrences[1]!.id, policy: 'keep-marker' }] } });
  expect(plan.entries.map((entry) => entry.proposal.kind)).toEqual(['remove-block', 'keep-marker']);
  expect(plan.warnings.join(' ')).toContain('leyenda');
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('no duplica propietarios por tablero y conserva apariciones compartidas entre Notas', () => {
  const source = notes();
  const snapshot = { ...source, cards: source.cards.map((card) => ({ ...card, contentDocument: { schemaVersion: 2 as const, blocks: [image] } })) };
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: analysis(snapshot) });
  expect(plan.summary).toMatchObject({ owners: 2, occurrences: 2, markers: 2 });
});

it.each(['archive', 'trash'] as const)('identifica %s sin convertirla en contenido activo', (kind) => {
  const source = notes();
  const result = kind === 'archive' ? archiveCard(source, source.cards[0]!.id, '2026-10-24T00:00:00Z') : trashCard(source, source.cards[0]!.id);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  const snapshot = result.value;
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: analysis(snapshot) });
  expect(plan.owners[0]?.collection).toBe(kind);
  expect(plan.owners[0]?.restorable).toBe(true);
  expect(plan.entries[0]?.proposal.kind).toBe('keep-marker');
  expect(snapshot.cards.some((card) => card.id === source.cards[0]!.id)).toBe(false);
});

it('mantiene revisable un snapshot con cobertura parcial, sin ejecución', () => {
  const snapshot = notes();
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: analysis(snapshot, ['Borradores y otras sesiones sin verificar']) });
  expect(plan.status).toBe('reviewable-partial');
  expect(plan.summary.markers).toBe(1);
  expect(plan.executionAllowed).toBe(false);
  expect(plan.coverage.limitations.join(' ')).toContain('sin verificar');
});

it('un cambio/reordenamiento invalida análisis y excepciones; nunca las reubica por Asset', () => {
  const source = notes({ schemaVersion: 2, blocks: [image, { ...image, alt: 'Otro' }] });
  const old = analysis(source);
  const changed = { ...source, cards: source.cards.map((card, index) => index === 0 ? { ...card, contentDocument: { ...card.contentDocument!, blocks: [...card.contentDocument!.blocks].reverse() } } : card) };
  expect(planAssetDetachment({ snapshot: changed, assetRef: ref, analysis: old }).status).toBe('stale');
  const current = analysis(changed);
  expect(planAssetDetachment({ snapshot: changed, assetRef: ref, analysis: current, exceptions: { sourceSnapshot: old.sourceSnapshot!, values: [{ occurrenceId: old.occurrences[0]!.id, policy: 'remove-block' }] } }).status).toBe('stale');
  const plan = planAssetDetachment({ snapshot: source, assetRef: ref, analysis: old });
  expect(isAssetDetachmentPlanCurrent(plan, changed, current)).toBe(false);
});

it('una excepción duplicada bloquea esa decisión en lugar de escoger la primera', () => {
  const snapshot = notes();
  const inspected = analysis(snapshot);
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: inspected, exceptions: { sourceSnapshot: inspected.sourceSnapshot!, values: [
    { occurrenceId: inspected.occurrences[0]!.id, policy: 'remove-block' }, { occurrenceId: inspected.occurrences[0]!.id, policy: 'keep-marker' },
  ] } });
  expect(plan.status).toBe('unresolved');
  expect(plan.entries[0]?.proposal.kind).toBe('unsupported');
});

it('ref auxiliares/campos sin tratamiento y dependencia de fuente bloquean completitud', () => {
  const source = notes();
  const snapshot = { ...source, cards: source.cards.map(({ contentDocument: _body, ...card }) => card) };
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: analysis(snapshot) });
  expect(plan.status).toBe('unresolved');
  expect(plan.entries[0]?.kind).toBe('asset-ref');
  expect(plan.carriers[0]?.proposal).toBe('unresolved');
  const deps = analyzeAssetReferences({ workspace: source, ref, unverified: [], dependencies: [{ kind: 'custom-font', ref, label: 'Dependencia aportada' }] });
  expect(planAssetDetachment({ snapshot: source, assetRef: ref, analysis: deps }).status).toBe('unresolved');
});

it('un campo asset no se borra como mirror y los errores no se presentan como cero usos', () => {
  const source = notes();
  const snapshot = { ...source, cards: source.cards.map((card, index) => index === 0 ? { ...card, fields: { ...card.fields, cover: ref } } : card) };
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: analysis(snapshot) });
  expect(plan.status).toBe('unresolved');
  expect(plan.entries.find((entry) => entry.kind === 'asset-field')?.proposal.kind).toBe('unsupported');
  expect(plan.carriers[0]?.proposal).toBe('unresolved');
  const invalid = { ...snapshot, cards: snapshot.cards.map((card, index) => index === 0 ? { ...card, fields: { ...card.fields, future: ref } } : card) };
  const blocked = planAssetDetachment({ snapshot: invalid, assetRef: ref, analysis: analysis(invalid) });
  expect(blocked.status).toBe('unresolved');
  expect(blocked.entries.length).toBeGreaterThan(0);
  expect(blocked.entries.every((entry) => entry.proposal.kind === 'unsupported')).toBe(true);
});

it('bloquea marker incompatible con leyenda enlazada, Markdown y primario con secundarios', () => {
  const withLink = notes({ schemaVersion: 2, blocks: [{ ...image, caption: [{ type: 'link', href: 'https://example.com', content: [{ type: 'text', text: 'Leyenda' }] }] }] });
  expect(planAssetDetachment({ snapshot: withLink, assetRef: ref, analysis: analysis(withLink) }).status).toBe('unresolved');
  const source = notes();
  const markdown = { ...source, cards: source.cards.map(({ contentDocument: _body, ...card }, index) => ({ ...card, ...(index === 0 ? { content: `![Mapa](${ref})` } : {}) })) };
  expect(planAssetDetachment({ snapshot: markdown, assetRef: ref, analysis: analysis(markdown) }).entries[0]?.proposal.kind).toBe('unsupported');
  const secondary = 'assets/images/otro.png' as AssetRef;
  const primary = { ...markdown, cardTypes: markdown.cardTypes.map((type) => ({ ...type, base: 'image' as const })), cards: markdown.cards.map(({ content: _body, ...card }, index) => ({ ...card, ...(index === 0 ? { assetRefs: [ref, secondary] } : {}) })) };
  expect(planAssetDetachment({ snapshot: primary, assetRef: ref, analysis: analysis(primary) }).status).toBe('unresolved');
});

it('no confía en un análisis manipulado con IDs ambiguos ni permite que modificar el plan altere la entrada', () => {
  const snapshot = notes();
  const inspected = analysis(snapshot);
  const bad = { ...inspected, occurrences: [...inspected.occurrences, inspected.occurrences[0]!] };
  expect(planAssetDetachment({ snapshot, assetRef: ref, analysis: bad }).status).toBe('unresolved');
  const plan = planAssetDetachment({ snapshot, assetRef: ref, analysis: inspected });
  const before = JSON.stringify({ snapshot, inspected });
  (plan.owners[0] as { title: string }).title = 'Cambio solo en salida';
  expect(JSON.stringify({ snapshot, inspected })).toBe(before);
});
