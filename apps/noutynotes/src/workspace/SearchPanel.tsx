import { searchWorkspace, workspaceTags } from '@noutynotes/application';
import type { SearchResult } from '@noutynotes/application';
import type { Workspace } from '@noutynotes/domain';
import { useTheme } from '@noutynotes/ui';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { ActionButton, TextField } from '../components/controls';
import { Dialog } from '../components/Dialog';

interface SearchPanelProps {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly workspace: Workspace;
  readonly busy: boolean;
  readonly onGo: (result: SearchResult) => void;
  readonly onRenameTag: (from: string, to: string) => Promise<boolean>;
  readonly onRemoveTag: (tag: string) => Promise<boolean>;
  readonly onClose: () => void;
}

type Pending = { readonly kind: 'rename' | 'remove'; readonly tag: string; readonly count: number } | null;

/**
 * Búsqueda dentro del proyecto abierto y sus etiquetas (ADR 0019). La consulta es pura: el panel no
 * escribe nada salvo renombrar o quitar una etiqueta, siempre con confirmación y el número de tarjetas.
 */
export function SearchPanel({ visible, compact, workspace, busy, onGo, onRenameTag, onRemoveTag, onClose }: SearchPanelProps) {
  const { theme } = useTheme();
  const colors = theme.colors;
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [newName, setNewName] = useState('');
  const results = searchWorkspace(workspace, query);
  const tags = workspaceTags(workspace);
  const hasQuery = query.trim() !== '';
  const toggleTag = (tag: string) => {
    const token = `#${tag}`;
    const words = query.trim().split(/\s+/).filter(Boolean);
    setQuery((words.includes(token) ? words.filter((word) => word !== token) : [...words, token]).join(' '));
  };
  const close = () => { setPending(null); onClose(); };
  const confirm = async () => {
    if (!pending || busy) return;
    const done = pending.kind === 'rename' ? await onRenameTag(pending.tag, newName) : await onRemoveTag(pending.tag);
    if (done) {
      setQuery((current) => current.split(/\s+/).filter((word) => word !== `#${pending.tag}`).join(' '));
      setPending(null);
      setNewName('');
    }
  };

  return (
    <Dialog visible={visible} title="Buscar en este proyecto" compact={compact} onClose={close} testID="search-panel">
      <TextField label="Buscar" value={query} onChangeText={setQuery} placeholder="palabras o #etiqueta" testID="search-input" />
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Busca en títulos, textos, etiquetas y tipos de este proyecto, sin distinguir mayúsculas ni acentos. La Papelera no se incluye.
      </Text>

      <Text style={[styles.section, { color: colors.textSecondary }]}>ETIQUETAS DEL PROYECTO</Text>
      {tags.length === 0 ? (
        <Text testID="search-no-tags" style={[styles.hint, { color: colors.textSecondary }]}>Todavía no hay etiquetas. Añádelas desde el editor de una tarjeta.</Text>
      ) : (
        <View style={styles.tags}>
          {tags.map(({ tag, count }) => {
            const active = query.split(/\s+/).includes(`#${tag}`);
            return (
              <View key={tag} style={[styles.tagRow, { borderColor: colors.gridLine }]}>
                <ActionButton label={`#${tag} · ${count}`} accessibilityLabel={`${active ? 'Quitar el filtro' : 'Filtrar por'} #${tag} (${count} ${count === 1 ? 'tarjeta' : 'tarjetas'})`}
                  pressed={active} onPress={() => toggleTag(tag)} />
                <ActionButton label="Renombrar" accessibilityLabel={`Renombrar la etiqueta ${tag}`} onPress={() => { setNewName(tag); setPending({ kind: 'rename', tag, count }); }} />
                <ActionButton label="Quitar" accessibilityLabel={`Quitar la etiqueta ${tag} de todas las tarjetas`} onPress={() => setPending({ kind: 'remove', tag, count })} />
              </View>
            );
          })}
        </View>
      )}

      {pending ? (
        <View testID="tag-confirmation" style={[styles.confirm, { borderColor: colors.danger, backgroundColor: colors.surface }]}>
          <Text style={[styles.body, { color: colors.textPrimary }]}>
            {pending.kind === 'rename'
              ? `Renombrar #${pending.tag} en ${pending.count === 1 ? '1 tarjeta' : `${pending.count} tarjetas`} (y en la Papelera). Si el nombre nuevo ya existe, se fusionan.`
              : `¿Quitar #${pending.tag} de ${pending.count === 1 ? '1 tarjeta' : `${pending.count} tarjetas`} (y de la Papelera)? El texto de las tarjetas no cambia.`}
          </Text>
          {pending.kind === 'rename' ? <TextField label="Nuevo nombre" value={newName} onChangeText={setNewName} placeholder="#nombre" testID="tag-rename-input" /> : null}
          <View style={styles.actions}>
            <ActionButton label={pending.kind === 'rename' ? 'Renombrar' : 'Quitar de todas'} tone="primary"
              accessibilityLabel={pending.kind === 'rename' ? `Confirmar renombrar ${pending.tag}` : `Confirmar quitar ${pending.tag} de todas`}
              onPress={() => void confirm()} />
            <ActionButton label="Cancelar" accessibilityLabel="Cancelar el cambio de etiqueta" onPress={() => setPending(null)} />
          </View>
        </View>
      ) : null}

      <Text testID="search-count" accessibilityLiveRegion="polite" style={[styles.section, { color: colors.textSecondary }]}>
        {!hasQuery ? 'RESULTADOS' : results.length === 1 ? '1 RESULTADO' : `${results.length} RESULTADOS`}
      </Text>
      {!hasQuery ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Escribe palabras o toca una etiqueta.</Text>
      ) : results.length === 0 ? (
        <Text testID="search-empty" style={[styles.hint, { color: colors.textSecondary }]}>{`Sin resultados para «${query.trim()}».`}</Text>
      ) : (
        <View style={styles.results}>
          {results.map((result) => (
            <View key={result.cardId} testID={`search-result-${result.cardId}`} style={[styles.result, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text numberOfLines={2} style={[styles.resultTitle, { color: colors.textPrimary }]}>{result.title}</Text>
              <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>
                {`${result.typeLabel.toUpperCase()} · ${result.boards.length > 0 ? result.boards.map((board) => board.title).join(', ') : 'sin tablero'}`}
              </Text>
              {result.tags.length > 0 ? <Text numberOfLines={1} style={[styles.meta, { color: colors.selection }]}>{result.tags.map((tag) => `#${tag}`).join('  ')}</Text> : null}
              {result.excerpt !== '' ? <Text numberOfLines={2} style={[styles.excerpt, { color: colors.textPrimary }]}>{result.excerpt}</Text> : null}
              <ActionButton label="Ir" accessibilityLabel={`Ir a ${result.title}`} onPress={() => { close(); onGo(result); }} />
            </View>
          ))}
        </View>
      )}
    </Dialog>
  );
}

const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 18 },
  section: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 8 },
  tags: { gap: 6 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingBottom: 6, borderBottomWidth: 1 },
  confirm: { borderWidth: 2, padding: 10, gap: 8 },
  body: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  results: { gap: 8 },
  result: { borderWidth: 2, padding: 10, gap: 4, alignItems: 'flex-start' },
  resultTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  meta: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  excerpt: { fontSize: 13, lineHeight: 18 },
});
