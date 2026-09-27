import { describe, expect, it } from 'vitest';

import type { Workspace } from '@noutynotes/domain';

import { EMPTY_HISTORY, recordStep, redoStep, sameWorkspace, undoStep } from './history';

const ws = (name: string, extra: Record<string, unknown> = {}) => ({ id: 'w', schemaVersion: 1, metadata: { name }, ...extra }) as unknown as Workspace;

describe('Historial de deshacer (ADR 0026)', () => {
  it('deshacer y rehacer recorren los pasos; una acción nueva vacía rehacer; sin cambios no hay paso; límite de pasos', () => {
    const [a, b, c, d] = [ws('A'), ws('B'), ws('C'), ws('D')];
    let history = recordStep(EMPTY_HISTORY, { label: 'Uno', before: a, after: b });
    history = recordStep(history, { label: 'Dos', before: b, after: c });
    // Una acción que no cambió nada no crea paso.
    expect(recordStep(history, { label: 'Nada', before: c, after: ws('C') })).toBe(history);

    const undone = undoStep(history);
    expect(undone?.step.label).toBe('Dos');
    expect(undone?.step.before).toBe(b);
    const redone = redoStep(undone?.history ?? EMPTY_HISTORY);
    expect(redone?.step.after).toBe(c);
    expect(undoStep(EMPTY_HISTORY)).toBeNull();
    expect(redoStep(history)).toBeNull();
    // Deshacer y hacer otra cosa: ya no se puede rehacer lo deshecho.
    const branched = recordStep(undone?.history ?? EMPTY_HISTORY, { label: 'Tres', before: b, after: d });
    expect(redoStep(branched)).toBeNull();
    expect(branched.past.map((step) => step.label)).toEqual(['Uno', 'Tres']);

    let long = EMPTY_HISTORY;
    for (let i = 0; i < 60; i += 1) long = recordStep(long, { label: `P${i}`, before: ws(`${i}`), after: ws(`${i + 1}`) }, 50);
    expect(long.past).toHaveLength(50);
    expect(long.past[0]?.label).toBe('P10');
  });

  it('los textos seguidos de la misma tarjeta son un paso; otra tarjeta u otra acción cortan', () => {
    const [a, b, c, d] = [ws('A'), ws('B'), ws('C'), ws('D')];
    let history = recordStep(EMPTY_HISTORY, { label: 'Texto', before: a, after: b, mergeKey: 'text:1' });
    history = recordStep(history, { label: 'Texto', before: b, after: c, mergeKey: 'text:1' });
    expect(history.past).toHaveLength(1);
    expect(history.past[0]?.before).toBe(a);
    expect(history.past[0]?.after).toBe(c);
    history = recordStep(history, { label: 'Texto', before: c, after: d, mergeKey: 'text:2' });
    expect(history.past).toHaveLength(2);
  });

  it('la comparación no depende del orden de las claves', () => {
    expect(sameWorkspace(ws('A', { x: 1, y: [1, { p: 1, q: 2 }] }), ws('A', { y: [1, { q: 2, p: 1 }], x: 1 }))).toBe(true);
    expect(sameWorkspace(ws('A', { y: [1, 2] }), ws('A', { y: [2, 1] }))).toBe(false);
    expect(sameWorkspace(ws('A', { x: undefined }), ws('A'))).toBe(true);
  });
});
