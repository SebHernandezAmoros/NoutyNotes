import { describe, expect, it } from 'vitest';

import {
  addCardToBoard, annotateDocumentInDiary, cardAssetRefs, createEmptyWorkspaceNamed, dailyLog, editCardContent, importImageCard, modifyWorkspace, moveCardToArchive, moveCardToTrash,
  nextSequentialId, openDiaryEntry, restoreCardFromTrash, searchWorkspace,
} from '../../packages/application/src/index';
import type { WorkspaceStorageResult } from '../../packages/application/src/index';
import { validateWorkspace } from '../../packages/domain/src/index';
import type { BoardId, CardId, CardTypeId, FieldKey } from '../../packages/domain/src/index';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import { ArchiveStorage, DocumentTreeFolderPort, FolderStorage } from '../../packages/storage/src/index';

function ok<T>(result: WorkspaceStorageResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

describe('Daily Log con fechas reales (ADR 0024)', () => {
  it('las tarjetas creadas con fecha aparecen en su día; las entradas no duplican y viven fuera de los tableros', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Bitácora'));
    const nota = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Idea', createdAt: '2026-09-26T08:00:00.000Z' }));
    const antigua = ok(await addCardToBoard(storage, id, { kind: 'note', title: 'Sin fecha' }));
    const foto = ok(await importImageCard(storage, storage, id, { bytes: PNG, fileName: 'f.png', createdAt: '2026-09-26T09:00:00.000Z' }));
    const today = ok(await openDiaryEntry(storage, id, { day: '2026-09-26', createdAt: '2026-09-26T10:00:00.000Z', reuse: true }));
    // «Escribir la nota de hoy» reutiliza la del día; «Nueva entrada» crea otra.
    expect(ok(await openDiaryEntry(storage, id, { day: '2026-09-26', createdAt: '2026-09-26T11:00:00.000Z', reuse: true }))).toBe(today);
    const second = ok(await openDiaryEntry(storage, id, { day: '2026-09-26', createdAt: '2026-09-26T12:00:00.000Z', reuse: false }));
    expect(second).not.toBe(today);
    ok(await moveCardToArchive(storage, id, nota, '2026-09-26T13:00:00.000Z'));

    const workspace = ok(await storage.open(id));
    expect(workspace.boards.flatMap((board) => board.cardIds)).not.toContain(today);
    const log = dailyLog(workspace, '2026-09-26', 0);
    expect(log.entries.map((card) => card.id)).toEqual([today, second]);
    expect(log.created.map((item) => [item.card.id, item.time])).toEqual([[foto, '09:00']]);
    expect(log.archived.map((item) => [item.card.id, item.time])).toEqual([[nota, '13:00']]);
    expect(workspace.cards.find((card) => card.id === antigua)?.createdAt).toBeUndefined();
    // Las entradas se buscan como cualquier tarjeta.
    expect(searchWorkspace(workspace, 'diario').map((result) => result.cardId)).toEqual(expect.arrayContaining([today, second]));
    expect(codes(await openDiaryEntry(storage, id, { day: '26/09/2026', createdAt: '2026-09-26T10:00:00.000Z', reuse: true }))).toContain('invalid-workspace');
  });

  it('conserva una entrada enriquecida al enviarla a Papelera, reabrir y restaurar al Diario', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Diario seguro'));
    const entryId = ok(await openDiaryEntry(storage, id, {
      day: '2026-10-16', createdAt: '2026-10-16T18:00:00.000Z', reuse: false,
    }));
    ok(await editCardContent(storage, id, entryId, { title: 'Legada', content: 'Primera línea\nSegunda <línea> con ñ.' }));
    const beforeOpen = tree.snapshot();
    expect(ok(await openDiaryEntry(storage, id, {
      day: '2026-10-16', createdAt: '2026-10-16T19:00:00.000Z', reuse: true,
    }))).toBe(entryId);
    expect(tree.snapshot()).toEqual(beforeOpen);

    const document = {
      schemaVersion: 1 as const,
      blocks: [
        { type: 'heading' as const, level: 2 as const, content: [{ type: 'text' as const, text: 'Balance' }] },
        { type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Árbol, ñandú y <seguro>', marks: ['bold' as const] }] },
      ],
    };
    ok(await editCardContent(storage, id, entryId, { title: 'Día especial', contentDocument: document }));
    expect(searchWorkspace(ok(await storage.open(id)), 'ñandu')[0]).toMatchObject({ cardId: entryId, excerpt: expect.stringContaining('Árbol') });

    ok(await moveCardToTrash(storage, id, entryId));
    const reopenedTrash = new FolderStorage(new DocumentTreeFolderPort(tree));
    expect(ok(await reopenedTrash.open(id)).trash?.[0]?.card).toMatchObject({ id: entryId, contentDocument: document, fields: { fecha: '2026-10-16' } });

    const report = ok(await restoreCardFromTrash(reopenedTrash, id, { cardId: entryId, fallbackBoardId: 'principal' as BoardId }));
    expect(report).toEqual({ relocated: [], addedToFallback: false, skippedRelations: 0 });
    const restored = ok(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(id));
    expect(restored.cards.find((card) => card.id === entryId)).toMatchObject({ title: 'Día especial', contentDocument: document, fields: { fecha: '2026-10-16' } });
    expect(restored.boards.every((board) => !board.cardIds.includes(entryId))).toBe(true);
  });
});

describe('Diario documental (B9-R4-11, MVP Nivel 2)', () => {
  const PDF_REF = 'assets/documents/manual.pdf';
  const TXT_REF = 'assets/documents/notas.txt';
  const MD_REF = 'assets/documents/guia.md';

  it('anota un PDF con página y crea una entrada nueva, nunca fusionada con la ya escrita ese día', async () => {
    const tree = new MemoryDocumentTree();
    const storage = new FolderStorage(new DocumentTreeFolderPort(tree));
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Con documentos'));
    const written = ok(await openDiaryEntry(storage, id, { day: '2026-11-02', createdAt: '2026-11-02T08:00:00.000Z', reuse: true }));
    const annotated = ok(await annotateDocumentInDiary(storage, id, {
      day: '2026-11-02', createdAt: '2026-11-02T09:00:00.000Z', documentRef: PDF_REF, documentName: 'Manual.pdf', reflection: 'Releer la sección 3.', page: 12,
    }));
    expect(annotated).not.toBe(written);
    const reopened = ok(await new FolderStorage(new DocumentTreeFolderPort(tree)).open(id));
    const log = dailyLog(reopened, '2026-11-02', 0);
    expect(log.entries.map((card) => card.id)).toEqual([written, annotated]);
    const entry = reopened.cards.find((card) => card.id === annotated)!;
    expect(entry).toMatchObject({ title: 'Manual.pdf', content: 'Releer la sección 3.', fields: { fecha: '2026-11-02', 'documento-ref': PDF_REF, 'documento-pagina': 12 } });
    // El campo `kind:'asset'` genérico ya alimenta el seguimiento de referencias sin un sistema nuevo.
    expect(cardAssetRefs(reopened, entry)).toContain(PDF_REF);
  });

  it('rechaza una página o línea que no sea un entero positivo, sin crear la entrada', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Validación'));
    const base = { day: '2026-11-02', createdAt: '2026-11-02T09:00:00.000Z', documentRef: PDF_REF, documentName: 'Manual.pdf', reflection: '' };
    expect(codes(await annotateDocumentInDiary(storage, id, { ...base, page: 0 }))).toContain('invalid-workspace');
    expect(codes(await annotateDocumentInDiary(storage, id, { ...base, page: 1.5 }))).toContain('invalid-workspace');
    expect(codes(await annotateDocumentInDiary(storage, id, { ...base, page: -3 }))).toContain('invalid-workspace');
    expect(codes(await annotateDocumentInDiary(storage, id, { ...base, documentRef: TXT_REF, line: 0 }))).toContain('invalid-workspace');
    expect(ok(await storage.open(id)).cards).toEqual([]);
  });

  it('dos anotaciones del mismo documento conviven, cada una con su ubicación (línea/sección), y ambas se reconocen como uso del mismo Asset', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'TXT y Markdown'));
    const first = ok(await annotateDocumentInDiary(storage, id, {
      day: '2026-11-02', createdAt: '2026-11-02T09:00:00.000Z', documentRef: TXT_REF, documentName: 'notas.txt', reflection: 'Primera lectura.', line: 4,
    }));
    const second = ok(await annotateDocumentInDiary(storage, id, {
      day: '2026-11-02', createdAt: '2026-11-02T10:00:00.000Z', documentRef: TXT_REF, documentName: 'notas.txt', reflection: 'Segunda lectura, línea distinta.', line: 9,
    }));
    expect(second).not.toBe(first);
    const workspace = ok(await storage.open(id));
    const catalog = workspace.cards.filter((card) => card.fields['documento-ref'] === TXT_REF);
    expect(catalog.map((card) => card.id).sort()).toEqual([first, second].sort());
    expect(catalog.flatMap((card) => cardAssetRefs(workspace, card))).toEqual([TXT_REF, TXT_REF]);

    const markdown = ok(await annotateDocumentInDiary(storage, id, {
      day: '2026-11-02', createdAt: '2026-11-02T11:00:00.000Z', documentRef: MD_REF, documentName: 'guia.md', reflection: 'Repasar antes de aplicar.', section: 'Resumen',
    }));
    expect(ok(await storage.open(id))).toMatchObject({ cards: expect.arrayContaining([expect.objectContaining({ id: markdown, fields: expect.objectContaining({ 'documento-seccion': 'Resumen' }) })]) });
  });

  it('actualiza la definición «diario» ya registrada con solo «fecha» (anterior a este correctivo) sin invalidar su entrada existente', async () => {
    const storage = new ArchiveStorage();
    const { id } = ok(await createEmptyWorkspaceNamed(storage, 'Workspace preexistente'));
    const legacyType = { id: 'diario' as CardTypeId, label: 'Entrada del diario', base: 'note' as const, fields: [{ key: 'fecha' as FieldKey, kind: 'date' as const, label: 'Fecha', required: true }] };
    const legacyEntryId = nextSequentialId('tarjeta', []) as CardId;
    ok(await modifyWorkspace(storage, id, (workspace) => validateWorkspace({
      ...workspace,
      cardTypes: [...workspace.cardTypes, legacyType],
      cards: [...workspace.cards, { id: legacyEntryId, typeId: legacyType.id, title: 'Diario 2026-01-01', fields: { fecha: '2026-01-01' }, content: 'Entrada antigua', createdAt: '2026-01-01T08:00:00.000Z' }],
    })));
    const annotated = ok(await annotateDocumentInDiary(storage, id, {
      day: '2026-11-02', createdAt: '2026-11-02T09:00:00.000Z', documentRef: PDF_REF, documentName: 'Manual.pdf', reflection: 'Funciona tras ampliar los campos.', page: 1,
    }));
    const workspace = ok(await storage.open(id));
    expect(workspace.cardTypes.filter((type) => type.id === 'diario')).toHaveLength(1);
    expect(workspace.cardTypes.find((type) => type.id === 'diario')?.fields.map((field) => field.key)).toEqual(
      expect.arrayContaining(['fecha', 'documento-ref', 'documento-pagina', 'documento-linea', 'documento-seccion']),
    );
    expect(workspace.cards.find((card) => card.id === legacyEntryId)).toMatchObject({ title: 'Diario 2026-01-01', content: 'Entrada antigua' });
    expect(workspace.cards.find((card) => card.id === annotated)).toMatchObject({ fields: { 'documento-ref': PDF_REF, 'documento-pagina': 1 } });
  });
});

function codes(result: WorkspaceStorageResult<unknown>) {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}
