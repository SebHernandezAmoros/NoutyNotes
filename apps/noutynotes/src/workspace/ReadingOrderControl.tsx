import { useLocale, useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { ActionButton } from '../components/controls';
import { Dialog } from '../components/Dialog';
import { moveReadingId, reconcileReadingOrder } from './readingOrder';

export interface ReadingItem {
  readonly id: string;
  readonly title: string;
  readonly typeLabel?: string;
  /** B9-R3-01: extracto breve ya resuelto por el llamador (p. ej. `readingPreviewText`) — este
   * control no vuelve a interpretar contenido, solo lo muestra como texto plano. */
  readonly excerpt?: string;
  /** Solo una URI ya lista (nunca una referencia a una imagen ausente/cargando): sin eso, la fila
   * no muestra miniatura en vez de intentar cargar algo que todavía no existe. */
  readonly thumbnailUri?: string;
}

/** One accessible ordering control reused by print, presentation and the List view. State stays with its owner. */
export function ReadingOrderControl({ items, order, onChange, excluded, onExcludedChange, testID }: {
  readonly items: readonly ReadingItem[];
  readonly order: readonly string[];
  readonly onChange: (ids: string[]) => void;
  readonly excluded?: ReadonlySet<string>;
  readonly onExcludedChange?: (ids: ReadonlySet<string>) => void;
  readonly testID: string;
}) {
  const { locale } = useLocale();
  const { theme } = useTheme();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const defaults = items.map((item) => item.id);
  const ids = reconcileReadingOrder(order, defaults);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const reset = () => { onChange(defaults); onExcludedChange?.(new Set()); };
  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    const next = [...ids];
    next.splice(next.indexOf(dragging), 1);
    next.splice(next.indexOf(target), 0, dragging);
    onChange(next);
    setDragging(null);
    setDragOver(null);
  };
  return <View testID={testID} style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: theme.colors.textPrimary, fontWeight: '700' }}>{locale === 'es' ? 'Orden de lectura' : 'Reading order'}</Text>
    <ActionButton label={locale === 'es' ? 'Restaurar orden predeterminado' : 'Restore default order'} onPress={reset} />
    <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
      {ids.map((id, index) => {
        const item = itemById.get(id);
        if (!item) return null;
        // Retroalimentación visual durante el arrastre (B9-R2-01): la fila que se suelta queda
        // semitransparente, y la fila bajo el cursor marca su borde de destino.
        const label = item.title || item.typeLabel || id;
        const row = <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6,
          opacity: dragging === id ? 0.4 : 1,
          backgroundColor: selected === id ? theme.colors.accent : theme.colors.surface, borderWidth: 1,
          borderColor: dragOver === id && dragging !== id ? theme.colors.selection : theme.colors.border }}>
          <Text testID={`${testID}-handle-${id}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={{ color: theme.colors.textSecondary, fontSize: 18, paddingHorizontal: 2, minWidth: 20, textAlign: 'center' }}>⠿</Text>
          {/* B9-R3-01: solo si ya hay una URI resuelta — nunca se intenta cargar una imagen ausente o
              todavía cargando, ni se reserva el espacio cuando la entrada no tiene ninguna. */}
          {item.thumbnailUri ? <Image accessibilityIgnoresInvertColors source={{ uri: item.thumbnailUri }} resizeMode="cover"
            style={{ width: 36, height: 36, borderWidth: 1, borderColor: theme.colors.border }} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`${index + 1}. ${label}`}
            accessibilityState={{ selected: selected === id }} onPress={() => setSelected(id)} style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 2 }}>
            <Text style={{ color: theme.colors.textPrimary, fontWeight: '700' }} numberOfLines={2}>{`${index + 1}. ${label}`}</Text>
            {item.excerpt ? <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }} numberOfLines={2}>{item.excerpt}</Text> : null}
          </Pressable>
          {onExcludedChange && excluded ? <ActionButton label={excluded.has(id) ? (locale === 'es' ? 'Incluir' : 'Include') : (locale === 'es' ? 'Omitir' : 'Exclude')}
            accessibilityLabel={`${excluded.has(id) ? (locale === 'es' ? 'Incluir' : 'Include') : (locale === 'es' ? 'Omitir' : 'Exclude')} ${item.title}`}
            onPress={() => { const next = new Set(excluded); if (next.has(id)) next.delete(id); else next.add(id); onExcludedChange(next); }} /> : null}
          <ActionButton label="↑" accessibilityLabel={`${locale === 'es' ? 'Subir' : 'Move up'} ${item.title}`} disabled={index === 0} onPress={() => onChange(moveReadingId(ids, id, -1))} />
          <ActionButton label="↓" accessibilityLabel={`${locale === 'es' ? 'Bajar' : 'Move down'} ${item.title}`} disabled={index === ids.length - 1} onPress={() => onChange(moveReadingId(ids, id, 1))} />
        </View>;
        return Platform.OS === 'web' ? <div key={id} draggable onDragStart={(event) => { setDragging(id); event.dataTransfer.setData('text/plain', id); }}
          onDragEnter={() => setDragOver(id)} onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); drop(id); }} onDragEnd={() => { setDragging(null); setDragOver(null); }}
          aria-label={`${locale === 'es' ? 'Arrastrar para ordenar' : 'Drag to reorder'} ${item.title}`}>
          {row}
        </div> : <View key={id}>{row}</View>;
      })}
    </ScrollView>
  </View>;
}

/**
 * Mismo control, en un diálogo propio (B9-R2-01): el usuario pidió arrastrar y soltar dentro de un
 * modal, no una franja que reemplaza el contenido de Imprimir/Presentar/Lista. Un único envoltorio
 * reutilizado por las tres herramientas, en vez de tres diálogos independientes.
 */
export function ReadingOrderDialog({ visible, compact, onClose, ...control }: {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly onClose: () => void;
} & Parameters<typeof ReadingOrderControl>[0]) {
  const { locale } = useLocale();
  return <Dialog visible={visible} title={locale === 'es' ? 'Orden de lectura' : 'Reading order'} compact={compact} presentation="centered" onClose={onClose} testID={`${control.testID}-dialog`}>
    <ReadingOrderControl {...control} />
  </Dialog>;
}
