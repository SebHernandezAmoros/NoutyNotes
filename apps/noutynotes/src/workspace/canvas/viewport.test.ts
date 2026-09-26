import { describe, expect, it } from 'vitest';

import { MAX_ZOOM, MIN_ZOOM, clampPan, formatZoom, panToReveal, panToRevealWorld, renderBase, visibleCells, visibleGridLines, worldPan, zoomIn, zoomOut } from './viewport';

describe('cámara del mundo bidireccional', () => {
  it('permite explorar los cuatro sentidos sin depender del contenido', () => {
    expect(worldPan({ x: -2400, y: -3600 })).toEqual({ x: -2400, y: -3600 });
    expect(worldPan({ x: 2400, y: 3600 })).toEqual({ x: 2400, y: 3600 });
    expect(panToRevealWorld({ x: 0, y: 0 }, { left: -300, top: -400, width: 80, height: 80 }, 1, { width: 390, height: 600 }).x).toBeGreaterThan(0);
  });

  it('dibuja solo las líneas visibles aunque la cámara esté lejos del origen', () => {
    const lines = visibleGridLines(-1_000_000, 1, 96, 390);
    expect(lines.length).toBeLessThan(8);
    expect(lines.every((position) => position >= 0 && position <= 390)).toBe(true);
  });
});

describe('zoom del lienzo (ADR 0013)', () => {
  it('sube y baja por pasos fijos entre 50 % y 200 %', () => {
    expect(MIN_ZOOM).toBe(0.5);
    expect(MAX_ZOOM).toBe(2);
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomIn(2)).toBe(2);
    expect(zoomOut(0.5)).toBe(0.5);
    // Un valor intermedio va al paso siguiente o anterior.
    expect(zoomIn(0.8)).toBe(1);
    expect(zoomOut(0.8)).toBe(0.75);
  });

  it('muestra el porcentaje redondeado', () => {
    expect(formatZoom(1)).toBe('100 %');
    expect(formatZoom(0.75)).toBe('75 %');
    expect(formatZoom(1.25)).toBe('125 %');
  });
});

describe('desplazamiento del lienzo', () => {
  const viewport = { width: 400, height: 600 };
  const content = { width: 1152, height: 640 };

  it('permite recorrer todo el contenido y un margen, pero no perderlo de vista', () => {
    expect(clampPan({ x: 0, y: 0 }, content, 1, viewport)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: 500, y: 500 }, content, 1, viewport)).toEqual({ x: 48, y: 48 });
    expect(clampPan({ x: -5000, y: -5000 }, content, 1, viewport)).toEqual({ x: 400 - 1152 - 48, y: 600 - 640 - 48 });
  });

  it('con zoom, el contenido escalado marca el límite', () => {
    expect(clampPan({ x: -5000, y: 0 }, content, 0.5, viewport)).toEqual({ x: 400 - 576 - 48, y: 0 });
    // Si el contenido cabe, no se desplaza más allá del margen.
    expect(clampPan({ x: -5000, y: -5000 }, { width: 200, height: 200 }, 1, viewport)).toEqual({ x: -48, y: -48 });
  });
});

describe('mostrar una tarjeta enfocada', () => {
  const viewport = { width: 400, height: 300 };
  const content = { width: 1152, height: 640 };

  it('no mueve el lienzo si la tarjeta ya se ve entera', () => {
    const pan = { x: -10, y: 0 };
    expect(panToReveal(pan, { left: 40, top: 20, width: 200, height: 100 }, content, 1, viewport)).toBe(pan);
  });

  it('desplaza lo mínimo para mostrarla, hacia cualquier lado, con un margen y dentro de los límites', () => {
    // A la derecha: su borde derecho queda a 16 px del borde del lienzo.
    expect(panToReveal({ x: 0, y: 0 }, { left: 500, top: 20, width: 200, height: 100 }, content, 1, viewport)).toEqual({ x: -316, y: 0 });
    // A la izquierda y arriba (ya desplazado): vuelve a verse su esquina superior izquierda.
    expect(panToReveal({ x: -600, y: -200 }, { left: 40, top: 20, width: 200, height: 100 }, content, 1, viewport)).toEqual({ x: -24, y: -4 });
    // Con zoom se usan las medidas escaladas.
    expect(panToReveal({ x: 0, y: 0 }, { left: 500, top: 0, width: 200, height: 100 }, content, 0.5, viewport)).toEqual({ x: 0, y: 0 });
    // Más ancha que el lienzo: se prioriza su borde izquierdo.
    expect(panToReveal({ x: 0, y: 0 }, { left: 600, top: 0, width: 600, height: 100 }, content, 1, viewport).x).toBe(-584);
    // Hacia abajo.
    expect(panToReveal({ x: 0, y: 0 }, { left: 40, top: 400, width: 200, height: 100 }, content, 1, viewport)).toEqual({ x: 0, y: -216 });
  });
});

describe('zona visible en celdas (P2: dónde colocar una tarjeta nueva)', () => {
  const metrics = { cell: 56, row: 56 };

  it('toma las celdas enteras que se ven, también a la izquierda y arriba del origen', () => {
    // Cámara en el arranque (16 px de margen): 6 columnas completas en 378 px.
    expect(visibleCells({ x: 16, y: 16 }, 1, metrics, { width: 378, height: 300 })).toEqual({ x: 0, y: 0, columns: 6 });
    // Desplazada 10 celdas a la derecha y 5 abajo del origen: la zona empieza en -10, -5.
    expect(visibleCells({ x: 560, y: 280 }, 1, metrics, { width: 378, height: 300 })).toEqual({ x: -10, y: -5, columns: 6 });
    // Con zoom 50 % caben el doble.
    expect(visibleCells({ x: 0, y: 0 }, 0.5, metrics, { width: 378, height: 300 })).toEqual({ x: 0, y: 0, columns: 13 });
  });

  it('nunca devuelve una banda vacía', () => {
    expect(visibleCells({ x: 0, y: 0 }, 1, metrics, { width: 20, height: 20 }).columns).toBe(1);
  });
});

describe('base de pintado cerca de la cámara (P2: precisión lejos del origen)', () => {
  it('lo que se pinta queda cerca de cero aunque la cámara esté a millones de píxeles', () => {
    const pan = { x: -95_904_000 + 300, y: 95_904_000 - 200 };
    const base = renderBase(pan, 1);
    // Traslación de la capa = pan + base × zoom: pequeña.
    expect(Math.abs(pan.x + base.x)).toBeLessThan(4096);
    expect(Math.abs(pan.y + base.y)).toBeLessThan(4096);
    // Cuantizada: no cambia con cada píxel de desplazamiento.
    expect(renderBase({ x: pan.x - 10, y: pan.y + 10 }, 1)).toEqual(base);
    expect(renderBase({ x: 16, y: 16 }, 1)).toEqual({ x: 0, y: 0 });
  });

  it('con zoom, la base está en píxeles del mundo', () => {
    const base = renderBase({ x: -1_000_000, y: 0 }, 0.5);
    expect(Math.abs(-1_000_000 + base.x * 0.5)).toBeLessThan(4096);
  });
});
