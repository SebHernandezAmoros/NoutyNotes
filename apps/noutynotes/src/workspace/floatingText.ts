import type { FloatingTextColor } from '@noutynotes/domain';

/** Paleta cerrada de P13: portable; `default` sigue el tema de la superficie. */
export function floatingTextColor(color: FloatingTextColor | undefined, fallback: string): string {
  const rgb = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(fallback);
  const darkSurface = rgb ? (Number.parseInt(rgb[1] as string, 16) * 299 + Number.parseInt(rgb[2] as string, 16) * 587 + Number.parseInt(rgb[3] as string, 16) * 114) / 1000 > 160 : false;
  if (darkSurface) {
    switch (color) {
      case 'red': return '#ff8a80';
      case 'orange': return '#ffb45e';
      case 'green': return '#79d991';
      case 'blue': return '#86b7ff';
      case 'purple': return '#d0a4ff';
      default: return fallback;
    }
  }
  switch (color) {
    case 'red': return '#b3261e';
    case 'orange': return '#9a4d00';
    case 'green': return '#2e6b3e';
    case 'blue': return '#2457a6';
    case 'purple': return '#7040a0';
    default: return fallback;
  }
}
