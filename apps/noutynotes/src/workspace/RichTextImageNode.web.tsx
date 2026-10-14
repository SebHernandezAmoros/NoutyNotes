import type { RichTextImage, RichTextInline } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { $getNodeByKey, $getRoot, DecoratorNode } from 'lexical';
import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';

type CaptionPosition = 'bottom' | 'top' | 'left' | 'right';

interface ImageEditorContextValue {
  readonly images: ReadonlyMap<string, string>;
  readonly captionPosition: CaptionPosition;
  readonly onReplace?: ((blockIndex: number) => Promise<RichTextImage | null>) | undefined;
  readonly onOpenFullEditor?: (() => void) | undefined;
  readonly selectedKey?: NodeKey | null;
  readonly onSelect?: ((key: NodeKey | null) => void) | undefined;
}

const ImageEditorContext = createContext<ImageEditorContextValue>({ images: new Map(), captionPosition: 'bottom' });

export function RichTextImageProvider({ value, children }: { readonly value: ImageEditorContextValue; readonly children: ReactNode }) {
  const [selectedKey, setSelectedKey] = useState<NodeKey | null>(null);
  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid^="rich-image-"]')) setSelectedKey(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return <ImageEditorContext.Provider value={{ ...value, selectedKey, onSelect: setSelectedKey }}>{children}</ImageEditorContext.Provider>;
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
  const { theme } = useTheme();
  const context = useContext(ImageEditorContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const resizePercentRef = useRef<number | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const uri = context.images.get(current.assetRef);
  const caption = captionText(current.caption);
  const horizontal = context.captionPosition === 'left' || context.captionPosition === 'right';
  const reverse = context.captionPosition === 'top' || context.captionPosition === 'left';
  const selectedSize = current.size ?? 'full';
  const selectedAlignment = current.alignment ?? 'center';
  const selected = context.selectedKey === nodeKey;
  const savedPercent = selectedSize === 'small' ? 25 : selectedSize === 'medium' ? 50 : selectedSize === 'large' ? 75 : 100;
  const width = `${dragPercent ?? savedPercent}%`;
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
    if (!context.onReplace) { context.onOpenFullEditor?.(); return; }
    let index = -1;
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isRichTextImageNode(node)) index = $getRoot().getChildren().indexOf(node);
    });
    if (index < 0) return;
    const next = await context.onReplace(index);
    if (next) update((node) => node.setImage({ ...next, ...(current.size ? { size: current.size } : {}), ...(current.alignment ? { alignment: current.alignment } : {}) }));
  };
  const commitResize = (percent: number) => {
    const size: NonNullable<RichTextImage['size']> = percent <= 37 ? 'small' : percent <= 62 ? 'medium' : percent <= 87 ? 'large' : 'full';
    update((node) => node.setSize(size));
    resizePercentRef.current = null;
    setDragPercent(null);
  };
  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>, edge: 'left' | 'right') => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rootWidth = rootRef.current?.getBoundingClientRect().width ?? 1;
    const startX = event.clientX;
    const resize = (moveEvent: globalThis.PointerEvent) => {
      const direction = edge === 'right' ? 1 : -1;
      const next = Math.max(25, Math.min(100, savedPercent + direction * ((moveEvent.clientX - startX) / rootWidth) * 100));
      resizePercentRef.current = next;
      setDragPercent(next);
    };
    const finish = () => {
      window.removeEventListener('pointermove', resize);
      commitResize(resizePercentRef.current ?? savedPercent);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finish, { once: true });
  };
  const handleStyle = (position: CSSProperties): CSSProperties => ({
    position: 'absolute', width: 16, height: 16, padding: 0, border: '2px solid white',
    background: '#157a6e', boxShadow: '0 0 0 1px #111', touchAction: 'none', ...position,
  });
  const captionElement = (caption !== '' || advanced) ? (
    <label style={{ display: 'grid', gap: 4, minWidth: horizontal ? 140 : undefined, flex: horizontal ? '1 1 38%' : undefined }}>
      <span style={{ fontSize: 12, fontWeight: 700 }}>Leyenda</span>
      <input aria-label={`Leyenda de la imagen ${current.alt || 'sin descripción'}`} value={caption} placeholder="Añadir leyenda"
        onChange={(event) => update((node) => node.setCaption(event.currentTarget.value))}
        style={{ minHeight: 40, border: '1px solid currentColor', background: 'transparent', color: 'inherit', padding: '0 8px' }} />
    </label>
  ) : null;
  return (
    <div ref={rootRef} data-testid={`rich-image-${current.assetRef}`} contentEditable={false} role="group"
      aria-label={`Imagen: ${current.alt || 'sin descripción'}`} aria-selected={selected} tabIndex={0}
      onPointerDown={(event) => { event.stopPropagation(); context.onSelect?.(nodeKey); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { context.onSelect?.(null); setAdvanced(false); } }}
      style={{ position: 'relative', padding: 8, margin: '8px 0', display: 'grid', gap: 8, outline: selected ? '2px solid #157a6e' : 'none', outlineOffset: 2 }}>
      {selected ? <div data-testid="image-context-toolbar" role="toolbar" aria-label="Herramientas de la imagen" style={{ position: 'sticky', zIndex: 3, top: 0, display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, background: theme.colors.cardSurface, color: theme.colors.cardText, border: `1px solid ${theme.colors.border}` }}>
        {(['left', 'center', 'right'] as const).map((alignment) => <button key={alignment} type="button" aria-label={`Alinear imagen ${alignment === 'left' ? 'a la izquierda' : alignment === 'center' ? 'al centro' : 'a la derecha'}`} aria-pressed={selectedAlignment === alignment} onClick={() => update((node) => node.setAlignment(alignment))} style={{ ...controlStyle(selectedAlignment === alignment), minWidth: 44 }}>{alignment === 'left' ? '←' : alignment === 'center' ? '↔' : '→'}</button>)}
        <button type="button" aria-label={`Reemplazar la imagen ${current.alt || 'sin descripción'}`} onClick={() => { void replace(); }} style={controlStyle()}>Reemplazar</button>
        <button type="button" aria-label="Más opciones de imagen" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)} style={controlStyle(advanced)}>Más</button>
      </div> : null}
      <div data-testid="image-layout" style={{ width, maxWidth: '100%', justifySelf, display: 'flex', flexDirection: horizontal ? (reverse ? 'row-reverse' : 'row') : (reverse ? 'column-reverse' : 'column'), gap: 8, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', width: horizontal ? '62%' : '100%', background: 'transparent' }}>
          {uri ? <img data-testid="image-media" src={uri} alt={current.alt} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 280, objectFit: 'contain', background: 'transparent' }} />
            : <div data-testid="image-media" role="img" aria-label={`Imagen no disponible: ${current.alt || 'sin descripción'}`} style={{ minHeight: 96, display: 'grid', placeItems: 'center', border: '1px dashed currentColor' }}>Imagen no disponible</div>}
          {selected ? <>
            <button data-testid="image-resize-nw" type="button" aria-label="Redimensionar imagen desde la esquina superior izquierda" onPointerDown={(event) => beginResize(event, 'left')} style={handleStyle({ left: -8, top: -8, cursor: 'nwse-resize' })} />
            <button data-testid="image-resize-ne" type="button" aria-label="Redimensionar imagen desde la esquina superior derecha" onPointerDown={(event) => beginResize(event, 'right')} style={handleStyle({ right: -8, top: -8, cursor: 'nesw-resize' })} />
            <button data-testid="image-resize-sw" type="button" aria-label="Redimensionar imagen desde la esquina inferior izquierda" onPointerDown={(event) => beginResize(event, 'left')} style={handleStyle({ left: -8, bottom: -8, cursor: 'nesw-resize' })} />
            <button data-testid="image-resize-se" type="button" aria-label="Redimensionar imagen desde la esquina inferior derecha" onPointerDown={(event) => beginResize(event, 'right')} style={handleStyle({ right: -8, bottom: -8, cursor: 'nwse-resize' })} />
          </> : null}
        </div>
        {captionElement}
      </div>
      {advanced ? <div data-testid="image-advanced-options" style={{ display: 'grid', gap: 8 }}><label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Texto alternativo</span>
        <input aria-label={`Texto alternativo de la imagen ${current.alt || 'sin descripción'}`} value={current.alt}
          onChange={(event) => update((node) => node.setAlt(event.currentTarget.value))}
          style={{ minHeight: 40, border: '1px solid currentColor', background: 'transparent', color: 'inherit', padding: '0 8px' }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['small', 'medium', 'large', 'full'] as const).map((size) => <button key={size} type="button" aria-label={`Tamaño ${size === 'small' ? 'pequeño' : size === 'medium' ? 'mediano' : size === 'large' ? 'grande' : 'ajustar al ancho'} de la imagen`} aria-pressed={selectedSize === size} onClick={() => update((node) => node.setSize(size))} style={controlStyle(selectedSize === size)}>{size === 'small' ? '25%' : size === 'medium' ? '50%' : size === 'large' ? '75%' : 'Ancho'}</button>)}
        <button type="button" aria-label="Restaurar tamaño y alineación de la imagen" onClick={() => update((node) => { node.setSize(undefined); node.setAlignment(undefined); })} style={controlStyle()}>Restaurar</button>
        <button type="button" aria-label={`Subir la imagen ${current.alt || 'sin descripción'}`} onClick={() => move(-1)} style={{ ...controlStyle(), minWidth: 44 }}>↑</button>
        <button type="button" aria-label={`Bajar la imagen ${current.alt || 'sin descripción'}`} onClick={() => move(1)} style={{ ...controlStyle(), minWidth: 44 }}>↓</button>
        <button type="button" aria-label={`Quitar la imagen ${current.alt || 'sin descripción'}`} onClick={() => update((node) => node.remove())} style={controlStyle()}>Quitar</button>
      </div></div> : null}
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
