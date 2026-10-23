import type { RichTextImage } from '@noutynotes/domain';
import { $getRoot, createEditor } from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyReviewedImagePurpose, RichTextImageNode } from './RichTextImageNode.web';

vi.mock('@noutynotes/ui', () => ({ useTheme: () => ({ theme: { colors: {} } }) }));
afterEach(() => vi.restoreAllMocks());
const image: RichTextImage = { type: 'image', assetRef: 'assets/images/one.png' as RichTextImage['assetRef'], alt: 'Conservada', caption: [{ type: 'text', text: 'Leyenda' }], captionPolicy: 'explicit', accessibilityIntent: 'pending', size: 'medium' };
function fixture() {
  const errors: Error[] = [];
  const editor = createEditor({ namespace: 'image-review-feedback', nodes: [RichTextImageNode], onError: (error) => { errors.push(error); } });
  let key = '';
  editor.update(() => { const node = new RichTextImageNode(image); key = node.getKey(); $getRoot().append(node); }, { discrete: true });
  const read = () => editor.getEditorState().read(() => ($getRoot().getFirstChild() as RichTextImageNode | null)?.image());
  return { editor, key, read, errors };
}
describe('resultado real de la confirmación local de imagen', () => {
  it('solo confirma tras aplicar y leer el propósito, conservando los demás datos', () => {
    const { editor, key, read } = fixture();
    expect(applyReviewedImagePurpose(editor, key, image, 'informative')).toBe(true);
    expect(read()).toEqual({ ...image, accessibilityIntent: 'informative' });
  });
  it('no confirma una revisión obsoleta o un nodo ausente', () => {
    const { editor, key, read } = fixture();
    expect(applyReviewedImagePurpose(editor, key, { ...image, alt: 'Otra revisión' }, 'informative')).toBe(false);
    expect(applyReviewedImagePurpose(editor, 'missing', image, 'decorative')).toBe(false);
    expect(read()).toEqual(image);
  });
  it('no comunica éxito si Lexical captura un fallo de la operación', () => {
    const { editor, key, read, errors } = fixture();
    vi.spyOn(RichTextImageNode.prototype, 'setAccessibilityIntent').mockImplementation(() => { throw new Error('Fallo de confirmación'); });
    expect(applyReviewedImagePurpose(editor, key, image, 'informative')).toBe(false);
    expect(errors).toHaveLength(1);
    expect(read()).toEqual(image);
  });
  it('no comunica éxito si la operación no se aplica aunque no lance error', () => {
    const { editor, key, read } = fixture();
    vi.spyOn(RichTextImageNode.prototype, 'setAccessibilityIntent').mockImplementation(() => {});
    expect(applyReviewedImagePurpose(editor, key, image, 'informative')).toBe(false);
    expect(read()).toEqual(image);
  });
});
