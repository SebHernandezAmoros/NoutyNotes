import type { KeyboardEvent, MouseEvent } from 'react';

export function ConnectorPicker({ onPick }: { readonly onPick: (x: number, y: number) => void }) {
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onPick(event.clientX - rect.left, event.clientY - rect.top);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onPick(rect.width / 2, rect.height / 2);
  };
  return <div data-testid="canvas-background" role="button" aria-label="Marcar posición del conector" tabIndex={0}
    onClick={pick} onKeyDown={key}
    style={{ position: 'absolute', inset: 0, zIndex: 20, cursor: 'crosshair' }} />;
}
