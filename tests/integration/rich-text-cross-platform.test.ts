import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { editCardContent } from '../../packages/application/src/index';
import { validateRichTextDocument } from '../../packages/domain/src/index';
import type { CardId, RichTextDocument, WorkspaceId } from '../../packages/domain/src/index';
import { validWorkspace } from '../../packages/domain/src/__fixtures__/workspace';
import { MemoryDocumentTree } from '../../packages/storage/src/__fixtures__/document-tree';
import {
  ArchiveStorage,
  DocumentTreeFolderPort,
  FolderStorage,
  parseRichTextMarkdown,
  readWorkspaceArchive,
  serializeRichTextMarkdown,
  serializeWorkspace,
  writeWorkspaceArchive,
} from '../../packages/storage/src/index';
import type { FolderPort, WorkspaceDirectory } from '../../packages/storage/src/index';
import { isNativeRichTextDocument } from '../../apps/noutynotes/src/workspace/basicRichText';

const workspaceId = 'demo' as WorkspaceId;
const cardId = 'idea-a' as CardId;
const decoder = new TextDecoder();

function ok<T>(result: { readonly ok: true; readonly value: T } | {
  readonly ok: false;
  readonly issues: readonly { readonly code: string; readonly path: string }[];
}): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function fixture(): RichTextDocument {
  const input: unknown = JSON.parse(readFileSync(new URL('../fixtures/rich-text-p12.json', import.meta.url), 'utf8'));
  return ok(validateRichTextDocument(input));
}

class WebFolder implements WorkspaceDirectory {
  constructor(readonly files: Map<string, Uint8Array>) {}
  async listPaths() { return [...this.files.keys()]; }
  async read(path: string) { return this.files.get(path)?.slice(); }
  async write(path: string, bytes: Uint8Array) { this.files.set(path, bytes.slice()); }
  async remove(path: string) { this.files.delete(path); }
}

class WebPort implements FolderPort {
  constructor(readonly folder: WebFolder) {}
  async permission() { return true; }
  async folders() { return [{ key: 'demo', folder: this.folder }]; }
  async createFolder(): Promise<WorkspaceDirectory> { throw new Error('No se usa en esta prueba.'); }
}

const textsOf = (files: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(files)
  .filter(([path]) => !path.startsWith('assets/')).map(([path, bytes]) => [path, decoder.decode(bytes)]));
const assetsOf = (files: Record<string, Uint8Array>) => Object.fromEntries(Object.entries(files)
  .filter(([path]) => path.startsWith('assets/')));

describe('UX7 P12 — preservación Rich Text entre Android y web', () => {
  it('abre, conserva y devuelve bloques avanzados, extensiones, opacos y assets por SAF, carpeta y ZIP', async () => {
    const document = fixture();
    const markdown = ok(serializeRichTextMarkdown(document));
    expect(markdown).toContain('nouty-caption:v1');
    expect(markdown).toContain('nouty-table:v1:no-header');
    expect(ok(parseRichTextMarkdown(markdown)), markdown).toEqual(document);
    expect(isNativeRichTextDocument(document)).toBe(true);

    const base = validWorkspace();
    const workspace = {
      ...base,
      cards: base.cards.map((card) => card.id === cardId ? { ...card, content: markdown } : card),
    };
    const texts = ok(serializeWorkspace(workspace));
    const asset = Uint8Array.from({ length: 64 }, (_, index) => (index * 31) % 256);
    const source = {
      ...Object.fromEntries(Object.entries(texts).map(([path, text]) => [path, new TextEncoder().encode(text)])),
      'assets/images/a.png': asset,
    };

    // SAF Android: DocumentTreeFolderPort sobre el mismo contrato que usa la aplicación nativa.
    const tree = new MemoryDocumentTree();
    for (const [path, bytes] of Object.entries(source)) tree.put(`demo/${path}`, bytes);
    const android = new FolderStorage(new DocumentTreeFolderPort(tree));
    const opened = ok(await android.open(workspaceId));
    const androidCard = opened.cards.find((card) => card.id === cardId);
    const openedDocument = ok(parseRichTextMarkdown(androidCard?.content ?? ''));
    expect(openedDocument).toEqual(document);

    // Guardar desde el perfil Android no reconstruye ni elimina los bloques que allí son de solo lectura.
    const returnedMarkdown = ok(serializeRichTextMarkdown(openedDocument));
    ok(await editCardContent(android, workspaceId, cardId, { title: 'Devuelta desde Android', content: returnedMarkdown }));

    const androidFiles = Object.fromEntries(Object.entries(tree.snapshot())
      .filter(([path]) => path.startsWith('demo/')).map(([path, bytes]) => [path.slice('demo/'.length), bytes]));
    expect(androidFiles['assets/images/a.png']).toEqual(asset);

    // Carpeta web y ZIP reabren exactamente el documento semántico devuelto por Android.
    const webFiles = new Map(Object.entries(androidFiles));
    const web = new FolderStorage(new WebPort(new WebFolder(webFiles)));
    const webCard = ok(await web.open(workspaceId)).cards.find((card) => card.id === cardId);
    expect(ok(parseRichTextMarkdown(webCard?.content ?? ''))).toEqual(document);

    const archiveBytes = ok(writeWorkspaceArchive(textsOf(androidFiles), assetsOf(androidFiles)));
    const archive = ok(readWorkspaceArchive(archiveBytes));
    const zip = new ArchiveStorage();
    ok(await zip.importArchive(archiveBytes));
    const zipCard = ok(await zip.open(workspaceId)).cards.find((card) => card.id === cardId);
    expect(ok(parseRichTextMarkdown(zipCard?.content ?? ''))).toEqual(document);
    expect(archive.assets['assets/images/a.png']).toEqual(asset);
  });
});
