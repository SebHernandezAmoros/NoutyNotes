import type { ShapeFill, ShapeStroke, ShapeStrokeWidth } from '@noutynotes/domain';

const lightFill: Record<Exclude<ShapeFill, 'transparent'>, string> = {
  red: '#efb1ab', orange: '#f2c792', yellow: '#eadb83', green: '#acd6ae', blue: '#b5cff2', purple: '#d3b9eb',
};
const darkFill: Record<Exclude<ShapeFill, 'transparent'>, string> = {
  red: '#713934', orange: '#704b27', yellow: '#625927', green: '#315d3a', blue: '#294d75', purple: '#52386e',
};
const lightStroke: Record<Exclude<ShapeStroke, 'default'>, string> = {
  red: '#b3261e', orange: '#9a4d00', yellow: '#766500', green: '#2e6b3e', blue: '#2457a6', purple: '#7040a0',
};
const darkStroke: Record<Exclude<ShapeStroke, 'default'>, string> = {
  red: '#ff8a80', orange: '#ffb45e', yellow: '#f2dc70', green: '#79d991', blue: '#86b7ff', purple: '#d0a4ff',
};

function isDark(hex: string): boolean {
  const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!rgb) return false;
  return (Number.parseInt(rgb[1] as string, 16) * 299 + Number.parseInt(rgb[2] as string, 16) * 587 + Number.parseInt(rgb[3] as string, 16) * 114) / 1000 < 130;
}

export function shapeFillColor(fill: ShapeFill | undefined, surface: string): string {
  if (!fill || fill === 'transparent') return 'transparent';
  return (isDark(surface) ? darkFill : lightFill)[fill];
}

export function shapeStrokeColor(stroke: ShapeStroke | undefined, fallback: string, surface: string): string {
  if (!stroke || stroke === 'default') return fallback;
  return (isDark(surface) ? darkStroke : lightStroke)[stroke];
}

export function shapeStrokePixels(width: ShapeStrokeWidth | undefined): number {
  return width === 'thin' ? 2 : width === 'thick' ? 6 : 4;
}
