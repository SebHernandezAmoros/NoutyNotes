import type { RichTextImage, RichTextInline } from '@noutynotes/domain';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { createContext, useContext } from 'react';
import type { JSX, ReactNode } from 'react';
import { $getNodeByKey, $getRoot, DecoratorNode } from 'lexical';
import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';

type CaptionPosition = 'bottom' | 'top' | 'left' | 'right';

interface ImageEditorContextValue {
  readonly images: ReadonlyMap<string, string>;
  readonly captionPosition: CaptionPosition;
  readonly onReplace?: ((blockIndex: number) => Promise<RichTextImage | null>) | undefined;
}

const ImageEditorContext = createContext<ImageEditorContextValue>({ images: new Map(), captionPosition: 'bottom' });

export function RichTextImageProvider({ value, children }: { readonly value: ImageEditorContextValue; readonly children: ReactNode }) {
  return <ImageEditorContext.Provider value={value}>{children}</ImageEditorContext.Provider>;
}

type SerializedRichTextImageNode = Spread<{
  type: 'nouty-image'; version: 1; assetRef: string; alt: string; caption?: readonly RichTextInline[]; size?: RichTextImage['size']; alignment?: RichTextImage['alignment'];
}, SerializedLexicalNode>;

function captionText(caption: readonly RichTextInline[] | undefined): string {
  return (caption ?? []).map((inline) => {
    if (inline.type === 'hard-break') return '\n';
    if (inline.type === 'link') return inline.content.map((leaf) => leaf.type === 'hard-break' ? '\n' : leaf.text).join('');
    return inline.text;
  }).join('');
}

function ImageBlock({ nodeKey, current }: { readonly nodeKey: NodeKey; readonly current: RichTextImage }) {
  const [editor] = useLexicalComposerContext();
  const context = useContext(ImageEditorContext);
  const uri = context.images.get(current.assetRef);
  const caption = captionText(current.caption);
  const horizontal = context.captionPosition === 'left' || context.captionPosition === 'right';
  const reverse = context.captionPosition === 'top' || context.captionPosition === 'left';
  const selectedSize = current.size ?? 'full';
  const selectedAlignment = current.alignment ?? 'center';
  const width = selectedSize === 'small' ? '25%' : selectedSize === 'medium' ? '50%' : selectedSize === 'large' ? '75%' : '100%';
  const justifySelf = selectedAlignment === 'left' ? 'start' : selectedAlignment === 'right' ? 'end' : 'center';
  const controlStyle = (selected = false) => ({
    minHeight: 44, border: '1px solid currentColor', background: 'transparent', color: 'inherit',
    fontWeight: selected ? 800 : 600, outline: selected ? '2px solid currentColor' : 'none', outlineOffset: selected ? 1 : 0,
  } as const);
  const update = (change: (node: RichTextImageNode) => void) => editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if ($isRichTextImageNode(node)) change(node);
  });
  const move = (delta: -1 | 1) => update((node) => {
    let sibling = delta < 0 ? node.getPreviousSibling() : node.getNextSibling();
    // Lexical puede mantener párrafos vacíos alrededor de un DecoratorNode para conservar una
    // posición editable del cursor. No son bloques visibles del documento ni deben impedir que una
    // imagen cambie de lugar respecto del siguiente bloque con contenido.
    while (sibling && !$isRichTextImageNode(sibling) && sibling.getTextContent().trim() === '') {
      sibling = delta < 0 ? sibling.getPreviousSibling() : sibling.getNextSibling();
    }
    if (!sibling) return;
    // Intercambiar el contenido mantiene estables las raíces React de los DecoratorNode. Mover dos
    // portales ya montados deja sus controles asociados al nodeKey anterior hasta otro render.
    if ($isRichTextImageNode(sibling)) {
      const currentImage = node.image();
      const siblingImage = sibling.image();
      node.setImage(siblingImage);
      sibling.setImage(currentImage);
      return;
    }
    const replacement = $createRichTextImageNode(node.image());
    node.remove();
    if (delta < 0) sibling.insertBefore(replacement);
    else sibling.insertAfter(replacement);
  });
  const replace = async () => {
    if (!context.onReplace) return;
    let index = -1;
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isRichTextImageNode(node)) index = $getRoot().getChildren().indexOf(node);
    });
    if (index < 0) return;
    const next = await context.onReplace(index);
    if (next) update((node) => node.setImage({ ...next, ...(current.size ? { size: current.size } : {}), ...(current.alignment ? { alignment: current.alignment } : {}) }));
  };
  const captionElement = (
    <label style={{ display: 'grid', gap: 4, minWidth: horizontal ? 140 : undefined, flex: horizontal ? '1 1 38%' : undefined }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>Leyenda</span>
      <input aria-label={`Leyenda de la imagen ${current.alt || current.assetRef}`} value={caption}
        onChange={(event) => update((node) => node.setCaption(event.currentTarget.value))}
        style={{ minHeight: 40, border: '1px solid currentColor', background: 'transparent', color: 'inherit', padding: '0 8px' }} />
    </label>
  );
  return (
    <div data-testid={`rich-image-${current.assetRef}`} contentEditable={false}
      style={{ border: '1px solid currentColor', padding: 8, margin: '8px 0', display: 'grid', gap: 8 }}>
      <div data-testid="image-layout" style={{ width, maxWidth: '100%', justifySelf, display: 'flex', flexDirection: horizontal ? (reverse ? 'row-reverse' : 'row') : (reverse ? 'column-reverse' : 'column'), gap: 8, alignItems: 'stretch' }}>
        {uri ? <img src={uri} alt={current.alt} style={{ display: 'block', width: horizontal ? '62%' : '100%', height: 'auto', maxHeight: 280, objectFit: 'contain' }} />
          : <div role="img" aria-label={`Imagen no disponible: ${current.alt || current.assetRef}`} style={{ minHeight: 96, flex: 1, display: 'grid', placeItems: 'center', border: '1px dashed currentColor' }}>Imagen no disponible</div>}
        {captionElement}
      </div>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Texto alternativo</span>
        <input aria-label={`Texto alternativo de ${current.assetRef}`} value={current.alt}
          onChange={(event) => update((node) => node.setAlt(event.currentTarget.value))}
          style={{ minHeight: 40, border: '1px solid currentColor', background: 'transparent', color: 'inherit', padding: '0 8px' }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['small', 'medium', 'large', 'full'] as const).map((size) => <button key={size} type="button" aria-label={`Tamaño ${size === 'small' ? 'pequeño' : size === 'medium' ? 'mediano' : size === 'large' ? 'grande' : 'ajustar al ancho'} de la imagen`} aria-pressed={selectedSize === size} onClick={() => update((node) => node.setSize(size))} style={controlStyle(selectedSize === size)}>{size === 'small' ? '25%' : size === 'medium' ? '50%' : size === 'large' ? '75%' : 'Ancho'}</button>)}
        {(['left', 'center', 'right'] as const).map((alignment) => <button key={alignment} type="button" aria-label={`Alinear imagen ${alignment === 'left' ? 'a la izquierda' : alignment === 'center' ? 'al centro' : 'a la derecha'}`} aria-pressed={selectedAlignment === alignment} onClick={() => update((node) => node.setAlignment(alignment))} style={{ ...controlStyle(selectedAlignment === alignment), minWidth: 44 }}>{alignment === 'left' ? '≡←' : alignment === 'center' ? '≡' : '→≡'}</button>)}
        <button type="button" aria-label="Restaurar tamaño y alineación de la imagen" onClick={() => update((node) => { node.setSize(undefined); node.setAlignment(undefined); })} style={controlStyle()}>Restaurar</button>
        <button type="button" aria-label={`Subir la imagen ${current.alt || current.assetRef}`} onClick={() => move(-1)} style={{ ...controlStyle(), minWidth: 44 }}>↑</button>
        <button type="button" aria-label={`Bajar la imagen ${current.alt || current.assetRef}`} onClick={() => move(1)} style={{ ...controlStyle(), minWidth: 44 }}>↓</button>
        {context.onReplace ? <button type="button" aria-label={`Reemplazar la imagen ${current.alt || current.assetRef}`} onClick={() => { void replace(); }} style={controlStyle()}>Reemplazar</button> : null}
        <button type="button" aria-label={`Quitar la imagen ${current.alt || current.assetRef}`} onClick={() => update((node) => node.remove())} style={controlStyle()}>Quitar</button>
      </div>
    </div>
  );
}

export class RichTextImageNode extends DecoratorNode<JSX.Element> {
  __assetRef: string;
  __alt: string;
  __caption: readonly RichTextInline[] | undefined;
  __size: RichTextImage['size'];
  __alignment: RichTextImage['alignment'];

  static getType(): string { return 'nouty-image'; }
  static clone(node: RichTextImageNode): RichTextImageNode { return new RichTextImageNode(node.image(), node.__key); }
  static importJSON(serialized: SerializedRichTextImageNode): RichTextImageNode {
    return new RichTextImageNode({ type: 'image', assetRef: serialized.assetRef as RichTextImage['assetRef'], alt: serialized.alt, ...(serialized.caption ? { caption: serialized.caption } : {}), ...(serialized.size ? { size: serialized.size } : {}), ...(serialized.alignment ? { alignment: serialized.alignment } : {}) });
  }
  constructor(image: RichTextImage, key?: NodeKey) {
    super(key);
    this.__assetRef = image.assetRef;
    this.__alt = image.alt;
    this.__caption = image.caption;
    this.__size = image.size;
    this.__alignment = image.alignment;
  }
  createDOM(_config: EditorConfig): HTMLElement { return document.createElement('div'); }
  updateDOM(_previous: this, _dom: HTMLElement, _config: EditorConfig): boolean { return false; }
  decorate(): JSX.Element { return <ImageBlock key={this.__key} nodeKey={this.__key} current={this.image()} />; }
  isInline(): false { return false; }
  exportJSON(): SerializedRichTextImageNode {
    return { ...super.exportJSON(), type: 'nouty-image', version: 1, assetRef: this.__assetRef, alt: this.__alt, ...(this.__caption ? { caption: this.__caption } : {}), ...(this.__size ? { size: this.__size } : {}), ...(this.__alignment ? { alignment: this.__alignment } : {}) };
  }
  image(): RichTextImage {
    const latest = this.getLatest();
    return { type: 'image', assetRef: latest.__assetRef as RichTextImage['assetRef'], alt: latest.__alt, ...(latest.__caption ? { caption: latest.__caption } : {}), ...(latest.__size ? { size: latest.__size } : {}), ...(latest.__alignment ? { alignment: latest.__alignment } : {}) };
  }
  setImage(image: RichTextImage): void {
    const writable = this.getWritable();
    writable.__assetRef = image.assetRef;
    writable.__alt = image.alt;
    writable.__caption = image.caption;
    writable.__size = image.size;
    writable.__alignment = image.alignment;
  }
  setAlt(alt: string): void { this.getWritable().__alt = alt; }
  setCaption(text: string): void { this.getWritable().__caption = text === '' ? undefined : [{ type: 'text', text }]; }
  setSize(size: RichTextImage['size']): void { this.getWritable().__size = size; }
  setAlignment(alignment: RichTextImage['alignment']): void { this.getWritable().__alignment = alignment; }
}

export function $createRichTextImageNode(image: RichTextImage): RichTextImageNode { return new RichTextImageNode(image); }
export function $isRichTextImageNode(node: LexicalNode | null | undefined): node is RichTextImageNode { return node instanceof RichTextImageNode; }
