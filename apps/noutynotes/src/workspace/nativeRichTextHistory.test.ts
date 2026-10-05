import { describe, expect, it } from 'vitest';

import { createNativeHistory, recordNativeHistory, stepNativeHistory } from './nativeRichTextHistory';

describe('historial local del editor enriquecido Android', () => {
  it('deshace y rehace cambios, elimina el futuro al escribir y no duplica estados', () => {
    let history = createNativeHistory('');
    history = recordNativeHistory(history, 'uno');
    history = recordNativeHistory(history, 'uno');
    history = recordNativeHistory(history, 'uno **dos**');

    expect(history).toEqual({ entries: ['', 'uno', 'uno **dos**'], index: 2 });

    const undone = stepNativeHistory(history, 'undo');
    expect(undone?.markdown).toBe('uno');
    history = undone!.history;

    const redone = stepNativeHistory(history, 'redo');
    expect(redone?.markdown).toBe('uno **dos**');

    history = recordNativeHistory(undone!.history, 'otro');
    expect(history).toEqual({ entries: ['', 'uno', 'otro'], index: 2 });
    expect(stepNativeHistory(history, 'redo')).toBeNull();
  });

  it('conserva un límite acotado sin perder el estado actual', () => {
    let history = createNativeHistory('0');
    for (let index = 1; index <= 110; index += 1) history = recordNativeHistory(history, String(index));

    expect(history.entries).toHaveLength(100);
    expect(history.entries.at(-1)).toBe('110');
    expect(history.index).toBe(99);
  });
});
