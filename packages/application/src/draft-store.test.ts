import { describe, expect, it } from 'vitest';

import {
  EditorialSessionCoordinator,
  MemoryDraftPersistence,
  PersistentDraftStore,
  createDraftKey,
  draftRevision,
} from './draft-store';

const key = createDraftKey('workspace-a', 'card-a', 'body');
const otherWorkspace = createDraftKey('workspace-b', 'card-a', 'body');
const now = () => '2026-10-09T12:00:00.000Z';
const valueOf = <T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T => {
  if (!result.ok) throw new Error('expected success');
  return result.value;
};

function input(source: string, baseRevision = draftRevision('durable-a')) {
  return {
    key,
    source: { format: 'html' as const, value: source },
    baseRevision,
    validation: { status: 'pending' as const },
  };
}

describe('PersistentDraftStore', () => {
  it('crea, actualiza, enumera y descarta por identidad workspace/tarjeta/zona', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new PersistentDraftStore(persistence, { now });
    const first = await store.save(input('<p>A</p>'));
    expect(first.ok && first.value.generation).toBe('1');
    const second = await store.save(input('<p>B</p>'));
    expect(second.ok && second.value.generation).toBe('2');
    expect(await store.read(key)).toEqual(second);
    expect(valueOf(await store.list('workspace-a'))).toHaveLength(1);
    expect(valueOf(await store.list('workspace-b'))).toEqual([]);
    expect((await store.discard(key, '2')).ok).toBe(true);
    expect(valueOf(await store.read(key))).toBeNull();
  });

  it('sobrevive a un reinicio simulado después de confirmar la escritura privada', async () => {
    const persistence = new MemoryDraftPersistence();
    const first = new PersistentDraftStore(persistence, { now });
    expect((await first.save(input('<p>Recuperable</p>'))).ok).toBe(true);
    const restarted = new PersistentDraftStore(persistence, { now });
    const recovered = await restarted.read(key);
    expect(recovered.ok && recovered.value?.source).toEqual({ format: 'html', value: '<p>Recuperable</p>' });
  });

  it('una confirmación antigua no elimina una edición posterior', async () => {
    const store = new PersistentDraftStore(new MemoryDraftPersistence(), { now });
    const a = await store.save(input('<p>A</p>'));
    const b = await store.save(input('<p>B</p>'));
    if (!a.ok || !b.ok) throw new Error('fixture');
    const stale = await store.confirm(key, a.value.generation, draftRevision('durable-a'));
    expect(stale.ok && stale.value).toBe('superseded');
    expect(valueOf(await store.read(key))?.source).toEqual({ format: 'html', value: '<p>B</p>' });
    const current = await store.confirm(key, b.value.generation, draftRevision('durable-b'));
    expect(current.ok && current.value).toBe('cleared');
    expect(valueOf(await store.read(key))).toBeNull();
  });

  it('serializa confirmaciones concurrentes de título y cuerpo sin resucitar una zona', async () => {
    const store = new PersistentDraftStore(new MemoryDraftPersistence(), { now });
    const titleKey = createDraftKey('workspace-a', 'card-a', 'title');
    const [title, body] = await Promise.all([
      store.save({ ...input('<p>Título</p>'), key: titleKey }),
      store.save(input('<p>Cuerpo</p>')),
    ]);
    if (!title.ok || !body.ok) throw new Error('fixture');
    await Promise.all([
      store.confirm(titleKey, title.value.generation, draftRevision('title-durable')),
      store.confirm(key, body.value.generation, draftRevision('body-durable')),
    ]);
    expect(valueOf(await store.list('workspace-a'))).toEqual([]);
  });

  it('conserva el HTML inválido exacto y detecta conflicto con la revisión durable', async () => {
    const store = new PersistentDraftStore(new MemoryDraftPersistence(), { now });
    const unsafe = '<script>alert("privado")</script>';
    const saved = await store.save({
      ...input(unsafe),
      validation: { status: 'invalid' as const, error: { code: 'unknown-tag', message: 'Etiqueta no admitida.', location: { line: 1, column: 1 } } },
    });
    expect(saved.ok && saved.value.source.value).toBe(unsafe);
    expect(saved.ok && store.conflicts(saved.value, draftRevision('changed'))).toBe(true);
    expect(saved.ok && store.conflicts(saved.value, saved.value.baseRevision)).toBe(false);
  });

  it('aísla workspaces y no elimina el borrador de una nota desaparecida', async () => {
    const store = new PersistentDraftStore(new MemoryDraftPersistence(), { now });
    await store.save(input('<p>A</p>'));
    await store.save({ ...input('<p>B</p>'), key: otherWorkspace });
    expect(valueOf(await store.list('workspace-a'))).toHaveLength(1);
    expect(valueOf(await store.list('workspace-b'))).toHaveLength(1);
    expect(valueOf(await store.read(key))).not.toBeNull();
  });

  it('informa fallos, corrupción y capacidad sin borrar el último snapshot válido', async () => {
    const persistence = new MemoryDraftPersistence();
    const store = new PersistentDraftStore(persistence, { now, maxDrafts: 1, maxSourceBytes: 32 });
    expect((await store.save(input('<p>A</p>'))).ok).toBe(true);
    persistence.failWrites = true;
    expect((await store.save(input('<p>B</p>'))).ok).toBe(false);
    persistence.failWrites = false;
    expect(valueOf(await new PersistentDraftStore(persistence, { now }).read(key))?.source).toEqual({ format: 'html', value: '<p>A</p>' });
    const second = createDraftKey('workspace-a', 'card-b', 'body');
    const full = await store.save({ ...input('<p>B</p>'), key: second });
    expect(full.ok ? '' : full.issues[0]?.code).toBe('capacity-exceeded');
    const oversized = await store.save(input('x'.repeat(64)));
    expect(oversized.ok ? '' : oversized.issues[0]?.code).toBe('source-too-large');
    persistence.corrupt('{no-json');
    const corrupt = await new PersistentDraftStore(persistence, { now }).list();
    expect(corrupt.ok ? '' : corrupt.issues[0]?.code).toBe('corrupt-store');
  });
});

describe('EditorialSessionCoordinator', () => {
  it('mantiene una autoridad por zona y rechaza escrituras de una sesión sustituida', () => {
    const sessions = new EditorialSessionCoordinator(() => 'session-a');
    const first = sessions.acquire(key, 'quick');
    expect(first.ok).toBe(true);
    const duplicate = sessions.acquire(key, 'full');
    expect(duplicate.ok).toBe(false);
    if (!first.ok) throw new Error('fixture');
    expect(sessions.transfer(first.value, 'full').ok).toBe(true);
    expect(sessions.release(first.value)).toBe(false);
  });
});
