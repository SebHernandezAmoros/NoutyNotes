import { describe, expect, it } from 'vitest';

import { deepFreeze } from '../../domain/src/__fixtures__/grid';
import { ideaA, ideaB, validWorkspace } from '../../domain/src/__fixtures__/workspace';
import type { Card, Workspace } from '@noutynotes/domain';
import { problems, unsafe, valueOf } from './__fixtures__/helpers';
import { MAX_FILES, MAX_TEXT_LENGTH } from './text-files';
import type { TextFiles } from './text-files';
import { parseWorkspace, serializeWorkspace } from './workspace-codec';

const base = (): Workspace => deepFreeze(validWorkspace());
const canonical = (): TextFiles => valueOf(serializeWorkspace(base()));
const withCard = (workspace: Workspace, card: Card): Workspace => ({ ...workspace, cards: workspace.cards.map((c) => (c.id === card.id ? card : c)) });
const edit = (files: TextFiles, path: string, text: string): TextFiles => ({ ...files, [path]: text });
const without = (files: TextFiles, path: string): TextFiles => Object.fromEntries(Object.entries(files).filter(([key]) => key !== path));

describe('workspace ↔ archivos', () => {
  it('genera los documentos administrados en rutas ordenadas y de forma determinista', () => {
    const files = canonical();
    expect(Object.keys(files)).toEqual([
      '.nouty/layout.yaml', '.nouty/relations.yaml', '.nouty/workspace.yaml',
      'boards/overview.md', 'boards/research.md', 'cards/idea-a.md', 'cards/idea-b.md',
    ]);
    expect(serializeWorkspace(base())).toEqual({ ok: true, value: files });
    expect(Object.values(files).every((text) => !text.includes('\r'))).toBe(true);
  });

  it('hace round-trip completo: identidad, campos, relaciones, layouts y referencias', () => {
    expect(valueOf(parseWorkspace(canonical()))).toEqual(validWorkspace());
  });

  it('no modifica el workspace ni el mapa de archivos recibidos', () => {
    const workspace = base();
    const snapshot = JSON.stringify(workspace);
    const files = deepFreeze(canonical());
    serializeWorkspace(workspace, files);
    parseWorkspace(files);
    expect(JSON.stringify(workspace)).toBe(snapshot);
  });

  it.each([
    ['vacío', ''],
    ['CRLF', '# Título\r\n\r\nTexto\r\n'],
    ['saltos finales y espacios', 'línea  \n\n\n'],
    ['solo espacios', '   '],
    ['empieza con saltos', '\n\n# Tarde'],
    ['separadores y cercas', '---\n\n```yaml\n---\nkey: value\n---\n```\n\n***\n---'],
    ['parece frontmatter', '---\nid: otra\n---\n'],
    ['unicode', 'ñandú 🦜 — “citas”\u2028fin'],
  ])('conserva exactamente el contenido Markdown %s', (_case, content) => {
    const workspace = withCard(base(), { ...ideaA, content });
    const parsed = valueOf(parseWorkspace(valueOf(serializeWorkspace(workspace))));
    expect(parsed.cards[0]?.content).toBe(content);
  });

  it('distingue contenido ausente de contenido vacío', () => {
    const files = valueOf(serializeWorkspace(withCard(base(), { ...ideaB, content: '' })));
    expect(files['cards/idea-b.md']).toContain('contentPresent: true');
    expect(valueOf(parseWorkspace(files)).cards[1]).toEqual({ ...ideaB, content: '' });
    const absent = valueOf(parseWorkspace(canonical())).cards[1];
    expect(absent && 'content' in absent).toBe(false);
  });

  it('conserva descripciones de board ausentes o presentes con Markdown literal', () => {
    const description = '## Board\r\n\r\n- punto\n';
    const workspace = { ...base(), boards: base().boards.map((b, i) => (i === 0 ? { ...b, description } : b)) };
    const files = valueOf(serializeWorkspace(workspace));
    expect(files['boards/overview.md']?.endsWith(`---\n${description}`)).toBe(true);
    const parsed = valueOf(parseWorkspace(files));
    expect(parsed.boards[0]?.description).toBe(description);
    expect(parsed.boards[1] && 'description' in parsed.boards[1]).toBe(false);
  });

  it('acepta delimitadores de frontmatter CRLF', () => {
    const files = canonical();
    const card = (files['cards/idea-b.md'] ?? '').replaceAll('\n', '\r\n');
    expect(valueOf(parseWorkspace(edit(files, 'cards/idea-b.md', card))).cards[1]).toEqual(ideaB);
  });

  it('ignora en el modelo los extras admitidos: README y archivos de texto bajo assets/', () => {
    const files = { ...canonical(), 'README.md': '# Demo\n', 'assets/notas.txt': 'x' };
    expect(valueOf(parseWorkspace(files))).toEqual(validWorkspace());
  });
});

describe('lectura de paquetes inválidos', () => {
  it.each<[string, (files: TextFiles) => TextFiles, string]>([
    ['sin manifiesto', (f) => without(f, '.nouty/workspace.yaml'), 'missing-file@.nouty/workspace.yaml'],
    ['tarjeta declarada ausente', (f) => without(f, 'cards/idea-b.md'), 'missing-file@cards/idea-b.md'],
    ['board declarado ausente', (f) => without(f, 'boards/research.md'), 'missing-file@boards/research.md'],
    ['sin layouts', (f) => without(f, '.nouty/layout.yaml'), 'missing-file@.nouty/layout.yaml'],
    ['sin relaciones', (f) => without(f, '.nouty/relations.yaml'), 'missing-file@.nouty/relations.yaml'],
    ['tarjeta no declarada', (f) => edit(f, 'cards/ghost.md', f['cards/idea-b.md'] ?? ''), 'unexpected-file@cards/ghost.md'],
    ['archivo desconocido', (f) => edit(f, 'notes.txt', 'x'), 'unexpected-file@notes.txt'],
    ['documento administrado desconocido', (f) => edit(f, '.nouty/cache.yaml', 'a: 1\n'), 'unexpected-file@.nouty/cache.yaml'],
    ['README en minúsculas', (f) => edit(f, 'readme.md', 'x'), 'unexpected-file@readme.md'],
    ['ruta no portable', (f) => edit(f, 'assets/a?.txt', 'x'), 'invalid-path@assets/a?.txt'],
    ['colisión de mayúsculas', (f) => edit(f, 'CARDS/idea-a.md', 'x'), 'path-collision@cards/idea-a.md'],
    ['identidad distinta', (f) => edit(f, 'cards/idea-b.md', (f['cards/idea-b.md'] ?? '').replace('id: idea-b', 'id: idea-c')), 'identity-mismatch@cards/idea-b.md#id'],
    ['identidad de board distinta', (f) => edit(f, 'boards/research.md', (f['boards/research.md'] ?? '').replace('id: research', 'id: overview')), 'identity-mismatch@boards/research.md#id'],
    ['sin frontmatter', (f) => edit(f, 'cards/idea-b.md', '# Nota\n'), 'invalid-document@cards/idea-b.md'],
    ['contenido con contentPresent false', (f) => edit(f, 'cards/idea-b.md', `${f['cards/idea-b.md'] ?? ''}texto`), 'invalid-document@cards/idea-b.md'],
    ['descripción con descriptionPresent false', (f) => edit(f, 'boards/research.md', `${f['boards/research.md'] ?? ''}texto`), 'invalid-document@boards/research.md'],
    ['versión de tarjeta posterior', (f) => edit(f, 'cards/idea-b.md', (f['cards/idea-b.md'] ?? '').replace('schemaVersion: 1', 'schemaVersion: 2')), 'unsupported-schema-version@cards/idea-b.md#schemaVersion'],
    ['versión de manifiesto posterior', (f) => edit(f, '.nouty/workspace.yaml', (f['.nouty/workspace.yaml'] ?? '').replace('schemaVersion: 1', 'schemaVersion: 2')), 'unsupported-schema-version@.nouty/workspace.yaml#schemaVersion'],
    ['clave desconocida en frontmatter', (f) => edit(f, 'cards/idea-b.md', (f['cards/idea-b.md'] ?? '').replace('id: idea-b', 'id: idea-b\ncolor: red')), 'unknown-property@cards/idea-b.md#color'],
    ['clave desconocida en manifiesto', (f) => edit(f, '.nouty/workspace.yaml', `${f['.nouty/workspace.yaml'] ?? ''}plugins: []\n`), 'unknown-property@.nouty/workspace.yaml#plugins'],
    ['YAML inválido en frontmatter', (f) => edit(f, 'cards/idea-b.md', (f['cards/idea-b.md'] ?? '').replace('id: idea-b', 'id: [idea-b')), 'invalid-yaml@cards/idea-b.md'],
    ['alias en frontmatter', (f) => edit(f, 'cards/idea-b.md', (f['cards/idea-b.md'] ?? '').replace('id: idea-b', 'id: &x idea-b')), 'invalid-yaml@cards/idea-b.md'],
    ['ID de manifiesto inválido', (f) => edit(f, '.nouty/workspace.yaml', (f['.nouty/workspace.yaml'] ?? '').replace('  - idea-b', '  - Idea B')), 'invalid-id@.nouty/workspace.yaml#cards[1]'],
    ['tarjeta repetida en manifiesto', (f) => edit(f, '.nouty/workspace.yaml', (f['.nouty/workspace.yaml'] ?? '').replace('  - idea-b', '  - idea-a')), 'duplicate-id@.nouty/workspace.yaml#cards[1]'],
    ['relación colgante', (f) => edit(f, '.nouty/relations.yaml', (f['.nouty/relations.yaml'] ?? '').replace('to: idea-b', 'to: ghost')), 'missing-reference@.nouty/relations.yaml#relations[0].to'],
    ['tipo inexistente', (f) => edit(f, 'cards/idea-b.md', (f['cards/idea-b.md'] ?? '').replace('typeId: note', 'typeId: task')), 'missing-reference@cards/idea-b.md#typeId'],
    ['board con tarjeta no declarada', (f) => edit(f, 'boards/research.md', (f['boards/research.md'] ?? '').replace('  - idea-a', '  - ghost')), 'missing-reference@boards/research.md#cardIds[0]'],
    ['campo incompatible', (f) => edit(f, 'cards/idea-b.md', (f['cards/idea-b.md'] ?? '').replace('score: 3', 'score: tres')), 'invalid-field-value@cards/idea-b.md#fields.score'],
    ['colocación de tarjeta ajena al board', (f) => edit(f, '.nouty/layout.yaml', (f['.nouty/layout.yaml'] ?? '').replace('boardId: overview', 'boardId: research')), 'invalid-membership@.nouty/layout.yaml#layouts[0].placements[1].cardId'],
    ['asset no portable', (f) => edit(f, 'cards/idea-a.md', (f['cards/idea-a.md'] ?? '').replace('  - assets/images/a.png', '  - assets/images/a?.png')), 'invalid-path@cards/idea-a.md#assetRefs[0]'],
    ['campo asset no portable', (f) => edit(f, 'cards/idea-a.md', (f['cards/idea-a.md'] ?? '').replace('cover: assets/images/a.png', 'cover: assets/con/a.png')), 'invalid-path@cards/idea-a.md#fields.cover'],
  ])('rechaza %s', (_case, change, expected) => {
    expect(problems(parseWorkspace(change(canonical())))).toContain(expected);
  });

  it('rechaza contenedores que no son un mapa de textos', () => {
    expect(problems(parseWorkspace(unsafe(null)))).toEqual(['invalid-files@files']);
    expect(problems(parseWorkspace(unsafe({ ...canonical(), 'README.md': 3 })))).toEqual(['invalid-files@README.md']);
  });
});

describe('escritura de workspaces inválidos', () => {
  it.each<[string, () => unknown, string]>([
    ['clave que se perdería', () => withCard(base(), unsafe({ ...ideaA, color: 'red' })), 'unknown-property@cards[0].color'],
    ['referencia colgante', () => ({ ...base(), relations: [{ id: 'r', typeId: 'references', from: 'idea-a', to: 'ghost' }] }), 'missing-reference@relations[0].to'],
    ['asset no portable', () => withCard(base(), unsafe({ ...ideaA, assetRefs: ['assets/a?.png'] })), 'invalid-path@cards[0].assetRefs[0]'],
    ['asset con sustituto aislado', () => withCard(base(), unsafe({ ...ideaA, assetRefs: [`assets/a${String.fromCharCode(0xd800)}.png`] })), 'invalid-path@cards[0].assetRefs[0]'],
    ['versión no admitida', () => ({ ...base(), schemaVersion: 2 }), 'unsupported-schema-version@schemaVersion'],
    ['no es un objeto', () => null, 'invalid-value@workspace'],
  ])('rechaza %s', (_case, workspace, expected) => {
    expect(problems(serializeWorkspace(unsafe(workspace())))).toContain(expected);
  });

  it('no ejecuta getters ni acepta funciones', () => {
    let read = false;
    const card = Object.defineProperty({ ...ideaA }, 'title', { enumerable: true, get: () => { read = true; return 'x'; } });
    expect(problems(serializeWorkspace(withCard(base(), card)))).toEqual(['executable-content@cards[0].title']);
    expect(read).toBe(false);
    expect(problems(serializeWorkspace(unsafe({ ...base(), metadata: { name: () => 'x' } })))).toEqual(['executable-content@metadata.name']);
  });

  it('aplica el límite de tamaño a los documentos generados', () => {
    const big = withCard(base(), { ...ideaA, content: 'x'.repeat(MAX_TEXT_LENGTH) });
    expect(problems(serializeWorkspace(big))).toEqual(['limit-exceeded@cards/idea-a.md']);
  });
});

describe('preservación con previousFiles', () => {
  it('rechaza un paquete anterior inválido antes de escribir', () => {
    const broken = edit(canonical(), 'cards/idea-b.md', 'sin frontmatter');
    expect(problems(serializeWorkspace(base(), broken))).toEqual(['invalid-document@previousFiles:cards/idea-b.md']);
    expect(problems(serializeWorkspace(base(), unsafe(null)))).toEqual(['invalid-files@previousFiles:files']);
    expect(problems(serializeWorkspace(base(), edit(canonical(), 'notes.txt', 'x')))).toEqual(['unexpected-file@previousFiles:notes.txt']);
  });

  it('conserva los bytes de cada documento sin cambios semánticos y regenera solo los modificados', () => {
    const previous = canonical();
    const commented: TextFiles = {
      ...previous,
      'cards/idea-b.md': (previous['cards/idea-b.md'] ?? '').replace('id: idea-b', '# comentario conservado\nid: "idea-b"'),
      '.nouty/relations.yaml': `# relaciones\n${previous['.nouty/relations.yaml'] ?? ''}`,
    };
    const renamed = withCard(base(), { ...ideaA, title: 'Idea A revisada' });
    const next = valueOf(serializeWorkspace(renamed, commented));
    for (const path of Object.keys(commented)) {
      if (path === 'cards/idea-a.md') expect(next[path]).toContain('title: Idea A revisada');
      else expect(next[path]).toBe(commented[path]);
    }
  });

  it('al eliminar una tarjeta retira solo su documento y conserva los extras admitidos', () => {
    const previous: TextFiles = { ...canonical(), 'README.md': '# Demo\r\n', 'assets/notas.txt': 'x' };
    const workspace = base();
    const reduced: Workspace = {
      ...workspace,
      cards: workspace.cards.filter((card) => card.id !== ideaB.id),
      boards: workspace.boards.map((board) => ({ ...board, cardIds: board.cardIds.filter((id) => id !== ideaB.id) })),
      layouts: workspace.layouts.map((layout) => ({ ...layout, placements: layout.placements.filter((p) => p.cardId !== ideaB.id) })),
      relations: [],
    };
    const next = valueOf(serializeWorkspace(reduced, previous));
    expect(Object.keys(next)).not.toContain('cards/idea-b.md');
    expect(next['README.md']).toBe('# Demo\r\n');
    expect(next['assets/notas.txt']).toBe('x');
    expect(next['cards/idea-a.md']).toBe(previous['cards/idea-a.md']);
    expect(next['boards/research.md']).toBe(previous['boards/research.md']);
    expect(next['boards/overview.md']).not.toBe(previous['boards/overview.md']);
    expect(valueOf(parseWorkspace(next))).toEqual(reduced);
  });

  it('los extras cuentan para el límite de archivos del resultado', () => {
    const assets = Object.fromEntries(Array.from({ length: MAX_FILES - 7 }, (_, i) => [`assets/f${i}.txt`, '']));
    const previous = { ...canonical(), ...assets };
    expect(serializeWorkspace(base(), previous).ok).toBe(true);
    const grown = { ...base(), cards: [...base().cards, { ...ideaB, id: unsafe<Card['id']>('idea-c') }] };
    expect(problems(serializeWorkspace(grown, previous))).toEqual(['limit-exceeded@files']);
  });
});
