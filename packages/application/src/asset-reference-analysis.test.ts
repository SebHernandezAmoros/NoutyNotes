import { describe, expect, it } from 'vitest';
import type { AssetRef, Card, FieldKey, Workspace } from '@noutynotes/domain';

import { analyzeAssetReferences } from './asset-reference-analysis';
import { removedImageDocument } from '../../../tests/fixtures/removed-image-blocks';

const ref = 'assets/images/mapa.png' as AssetRef;
const note = (id: string, extra: Partial<Card> = {}): Card => ({ id: id as Card['id'], typeId: 'note' as Card['typeId'], title: id, fields: {}, ...extra });
const workspace = (cards: readonly Card[]): Workspace => ({
  schemaVersion: 1, id: 'project' as Workspace['id'], metadata: { name: 'Proyecto' }, cards,
  cardTypes: [{ id: 'note' as Card['typeId'], label: 'Nota', base: 'note', fields: [] }],
  boards: [{ id: 'one' as Workspace['boards'][number]['id'], title: 'Uno', cardIds: cards.map((card) => card.id) }],
  layouts: [], relations: [], relationTypes: [],
});

describe('consulta de referencias U1', () => {
  it('U2-B reconoce el documento v3 e ignora el marcador sin perder usos de imágenes activas', () => {
    const snapshot = workspace([note('n', { contentDocument: { ...removedImageDocument, blocks: [
      ...removedImageDocument.blocks, { type: 'image', assetRef: ref, alt: 'Activa' },
    ] } })]);
    expect(analyzeAssetReferences({ workspace: snapshot, ref, unverified: [] })).toMatchObject({ status: 'complete-used', ownerCount: 1, occurrenceCount: 1 });
    expect(analyzeAssetReferences({ workspace: workspace([note('n', { contentDocument: removedImageDocument })]), ref, unverified: [] })).toMatchObject({ status: 'complete-unused', ownerCount: 0, occurrenceCount: 0 });
  });
  it('distingue tres apariciones de una propietaria y no suma el carrier redundante', () => {
    const snapshot = workspace([note('n', { assetRefs: [ref], contentDocument: { schemaVersion: 2, blocks: [
      { type: 'image', assetRef: ref, alt: 'Uno' },
      { type: 'image', assetRef: ref, alt: 'Dos' },
      { type: 'image', assetRef: ref, alt: 'Tres' },
    ] } })]);
    const before = JSON.stringify(snapshot);
    const result = analyzeAssetReferences({ workspace: snapshot, ref, unverified: [] });
    expect(result.status).toBe('complete-used');
    expect(result.ownerCount).toBe(1);
    expect(result.occurrenceCount).toBe(3);
    expect(new Set(result.occurrences.map((use) => use.id)).size).toBe(3);
    expect(result.carriers).toHaveLength(1);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(analyzeAssetReferences({ workspace: snapshot, ref, unverified: [] })).toEqual(result);
  });

  it('distingue ausencia completa de referencias de cobertura parcial', () => {
    const input = { workspace: workspace([]), ref, unverified: [] };
    expect(analyzeAssetReferences(input)).toMatchObject({ status: 'complete-unused', ownerCount: 0, occurrenceCount: 0 });
    const partial = analyzeAssetReferences({ ...input, unverified: ['Borradores no verificados'] });
    expect(partial.status).toBe('partial');
    expect(partial.issues).toEqual([{ kind: 'unverified', detail: 'Borradores no verificados' }]);
  });

  it('cuenta una aparición Markdown canónica y excluye código y texto literal', () => {
    const body = `Antes\n\n![uno](${ref})\n\nDespués\n\n\`\`\`md\n![código](${ref})\n\`\`\`\nTexto ${ref}`;
    const result = analyzeAssetReferences({ workspace: workspace([note('n', { content: body, assetRefs: [ref] })]), ref, unverified: [] });
    expect(result).toMatchObject({ status: 'complete-used', ownerCount: 1, occurrenceCount: 1 });
    expect(result.occurrences[0]).toMatchObject({ kind: 'markdown-image', locator: `content:${body.indexOf('![uno]')}` });
  });

  it('comparte el Asset entre propietarias, sin duplicar por tablero', () => {
    const w = workspace([note('a', { assetRefs: [ref] }), note('b', { assetRefs: [ref] })]);
    const result = analyzeAssetReferences({ workspace: { ...w, boards: [...w.boards, { ...w.boards[0]!, id: 'two' as Workspace['boards'][number]['id'] }] }, ref, unverified: [] });
    expect(result).toMatchObject({ ownerCount: 2, occurrenceCount: 2 });
    expect(result.owners[0]?.boards).toHaveLength(2);
    expect(new Set(result.owners.map((owner) => owner.id)).size).toBe(2);
  });

  it.each(['image', 'file'] as const)('reconoce la tarjeta primaria %s', (base) => {
    const w = workspace([note('resource', { typeId: base as Card['typeId'], assetRefs: [ref] })]);
    const result = analyzeAssetReferences({ workspace: { ...w, cardTypes: [{ id: base as Card['typeId'], label: base, base, fields: [] }] }, ref, unverified: [] });
    expect(result).toMatchObject({ ownerCount: 1, occurrenceCount: 1 });
    expect(result.occurrences[0]?.kind).toBe(base === 'image' ? 'image-card' : 'document-card');
  });

  it('mantiene Archivo y Papelera como propietarias restaurables y conserva ubicación', () => {
    const w = workspace([]);
    const snapshot = { card: note('saved', { assetRefs: [ref] }), boards: [{ boardId: w.boards[0]!.id, index: 0 }], placements: [], relations: [] };
    const result = analyzeAssetReferences({ workspace: { ...w,
      archive: [{ ...snapshot, archivedAt: '2026-10-24T00:00:00Z' }],
      trash: [{ ...snapshot, card: note('trashed', { assetRefs: [ref] }) }],
    }, ref, unverified: [] });
    expect(result.owners.map((owner) => [owner.collection, owner.restorable, owner.boards[0]?.title])).toEqual([
      ['archive', true, 'Uno'], ['trash', true, 'Uno'],
    ]);
    expect(result.occurrenceCount).toBe(2);
  });

  it('cuenta un campo asset independiente sin sumar su carrier', () => {
    const w = workspace([note('n', { fields: { attachment: ref }, assetRefs: [ref] })]);
    const result = analyzeAssetReferences({ workspace: { ...w, cardTypes: [{ ...w.cardTypes[0]!, fields: [{ key: 'attachment' as FieldKey, kind: 'asset' }] }] }, ref, unverified: [] });
    expect(result).toMatchObject({ status: 'complete-used', ownerCount: 1, occurrenceCount: 1 });
    expect(result.occurrences[0]?.kind).toBe('asset-field');
  });

  it('señala una dependencia desconocida y conserva las referencias conocidas', () => {
    const result = analyzeAssetReferences({ workspace: workspace([note('n', { fields: { future: ref }, assetRefs: [ref] })]), ref, unverified: [] });
    expect(result).toMatchObject({ status: 'unsupported', ownerCount: 1, occurrenceCount: 1 });
    expect(result.occurrences[0]?.kind).toBe('unknown-field');
  });

  it('no convierte contenido opaco/futuro en ausencia de referencias', () => {
    const w = workspace([note('n', { contentDocument: { schemaVersion: 1, blocks: [{ type: 'opaque-markdown', source: `![x](${ref})` }] } })]);
    expect(analyzeAssetReferences({ workspace: w, ref, unverified: [] }).status).toBe('unsupported');
  });

  it('distingue error de lectura e interpretación de lista vacía completa', () => {
    expect(analyzeAssetReferences({ ref, error: 'Lectura denegada' })).toMatchObject({ status: 'error', issues: [{ kind: 'error', detail: 'Lectura denegada' }] });
    const w = workspace([note('n', { contentDocument: { schemaVersion: 1, blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 8 }] }] } as unknown as NonNullable<Card['contentDocument']> })]);
    expect(analyzeAssetReferences({ workspace: w, ref, unverified: [] }).status).toBe('error');
  });

  it('una referencia agregada entre consultas aparece sin reutilizar el resultado anterior', () => {
    const w = workspace([]);
    const first = analyzeAssetReferences({ workspace: w, ref, unverified: [] });
    const next = analyzeAssetReferences({ workspace: { ...w, cards: [note('new', { assetRefs: [ref] })] }, ref, unverified: [] });
    expect(first.status).toBe('complete-unused');
    expect(next).toMatchObject({ status: 'complete-used', ownerCount: 1, occurrenceCount: 1 });
    expect(next.sourceSnapshot).not.toBe(first.sourceSnapshot);
  });

  it('separa dependencia de fuente de las propietarias y apariciones editoriales', () => {
    const result = analyzeAssetReferences({ workspace: workspace([]), ref, unverified: [], dependencies: [{ kind: 'custom-font', ref, label: 'Fuente de la sesión' }] });
    expect(result).toMatchObject({ status: 'complete-used', ownerCount: 0, occurrenceCount: 0 });
    expect(result.dependencies).toHaveLength(1);
  });

  it('un carrier repetido no inventa otra aparición de la imagen primaria', () => {
    const w = workspace([note('image', { typeId: 'image' as Card['typeId'], assetRefs: [ref, ref] })]);
    const result = analyzeAssetReferences({ workspace: { ...w, cardTypes: [{ id: 'image' as Card['typeId'], label: 'Imagen', base: 'image', fields: [] }] }, ref, unverified: [] });
    expect(result.ownerCount).toBe(1);
    expect(result.occurrenceCount).toBe(1);
    expect(result.carriers).toHaveLength(2);
  });

  it('examina también el cuerpo de una imagen heredada sin depender de la exclusión del catálogo', () => {
    const w = workspace([note('image', { typeId: 'image' as Card['typeId'], assetRefs: ['assets/images/otra.png' as AssetRef], content: `![mapa](${ref})` })]);
    const result = analyzeAssetReferences({ workspace: { ...w, cardTypes: [{ id: 'image' as Card['typeId'], label: 'Imagen', base: 'image', fields: [] }] }, ref, unverified: [] });
    expect(result).toMatchObject({ ownerCount: 1, occurrenceCount: 1 });
    expect(result.occurrences[0]?.kind).toBe('markdown-image');
  });
});
