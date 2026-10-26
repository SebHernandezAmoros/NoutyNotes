import type { BoardLayout, CardDisplayMode } from '@noutynotes/domain';
import type { CanvasMetrics, PixelBox, ResizeHandle } from './geometry';
import type { Point } from './viewport';

function closest(target: unknown, selector: string): boolean {
  return typeof target === 'object' && target !== null && 'closest' in target && typeof target.closest === 'function' && target.closest(selector) !== null;
}

/** Keyboard commands belong to the editorial control/reader before the surrounding Card. */
export function isEditorialTarget(target: unknown): boolean {
  return closest(target, 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"], [role="menu"], [data-testid^="card-reader-"]');
}

export function isCardDragTarget(target: unknown): boolean {
  return closest(target, '[data-testid^="card-header-"], [data-testid^="minimized-"]');
}

/** Local gesture identity, not a durable revision or a lock. */
export function gestureContext(input: { readonly workspaceId: string; readonly layout: BoardLayout | undefined; readonly metrics: CanvasMetrics;
  readonly zoom: number; readonly pan: Point; readonly tool: string; readonly snap: boolean }): string {
  return JSON.stringify([input.workspaceId, input.layout, input.metrics, input.zoom, input.pan, input.tool, input.snap]);
}

/** Small Cards use contextual controls rather than overlapping resize regions. */
export function handlesFor(box: Pick<PixelBox, 'width' | 'height'>, zoom: number, display: CardDisplayMode): readonly ResizeHandle[] {
  const w = box.width * zoom;
  const h = box.height * zoom;
  if (display === 'minimized' || w < 44 || h < 44) return [];
  if (display === 'collapsed') return w >= 88 ? ['w', 'e'] : ['e'];
  return w >= 88 && h >= 88 ? ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] : ['se'];
}

/** Reveal the outer hit regions as well as the paper; no durable geometry is changed. */
export function cardInteractionBox(box: PixelBox, zoom: number, display: CardDisplayMode): PixelBox {
  if (handlesFor(box, zoom, display).length === 0) return box;
  const margin = 44 / zoom;
  return { left: box.left - margin, top: box.top - margin, width: box.width + margin * 2, height: box.height + margin * 2 };
}

/** An interior 44 CSS px target, with a separate content row; tiny Cards use context/Inspector. */
export function headerlessGripLayout(box: Pick<PixelBox, 'width' | 'height'>, zoom: number): { readonly inset: number; readonly size: number; readonly contentTop: number; readonly contentLeft: number } | null {
  const w = box.width * zoom;
  const h = box.height * zoom;
  if (w < 52 || h < 52 || (h < 64 && w < 72)) return null;
  return { inset: 4 / zoom, size: 44 / zoom, contentTop: h >= 64 ? 48 / zoom : 0, contentLeft: h >= 64 ? 0 : 48 / zoom };
}
